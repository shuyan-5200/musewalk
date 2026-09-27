#!/usr/bin/env python3
"""Download license-reviewed paintings from Wikimedia Commons.

Every local file is backed by ``public/art/sources.manifest.json``. The
manifest records its canonical Commons page, resolved file title, license,
artist/credit metadata, and local hash. Exact titles and search fallbacks are
accepted only when Commons explicitly reports Public domain, CC0, or CC BY.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

UA = "Musewalk/1.0 (https://github.com/shuyan-5200/musewalk; Commons provenance downloader)"
API = "https://commons.wikimedia.org/w/api.php"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "art")
MANIFEST_PATH = os.path.join(OUT_DIR, "sources.manifest.json")
MIN_FILE_BYTES = 12_000
SEARCH_LIMIT = 12

# (id, exact Commons file title, search fallback, thumb width)
WORKS = [
    # ---- Classical ----
    ("botticelli-primavera", "Botticelli-primavera.jpg", "Botticelli Primavera Uffizi", 1800),
    ("botticelli-venus", "Sandro Botticelli - La nascita di Venere - Google Art Project - edited.jpg", "Birth of Venus Botticelli Google Art Project", 1800),
    ("davinci-monalisa", "Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg", "Mona Lisa Leonardo da Vinci C2RMF", 1200),
    ("davinci-ermine", "Lady with an Ermine - Leonardo da Vinci - Google Art Project.jpg", "Lady with an Ermine Leonardo da Vinci", 1200),
    ("vermeer-pearl", "1665 Girl with a Pearl Earring.jpg", "Girl with a Pearl Earring Vermeer", 1200),
    ("vermeer-milkmaid", "Johannes Vermeer - Het melkmeisje - Google Art Project.jpg", "Vermeer Milkmaid Google Art Project", 1200),
    ("rembrandt-nightwatch", "The Night Watch - HD.jpg", "Night Watch Rembrandt Rijksmuseum", 1800),
    ("rembrandt-self", "Rembrandt van Rijn - Self-Portrait - Google Art Project.jpg", "Rembrandt Self-Portrait 1659 Google Art Project", 1200),
    # ---- Modern ----
    ("monet-sunrise", "Monet - Impression, Sunrise.jpg", "Impression Sunrise Monet Marmottan", 1400),
    ("monet-waterlilies", "Claude Monet - Water Lilies - 1906, Ryerson.jpg", "Monet Water Lilies 1906 Art Institute", 1400),
    ("vangogh-starry", "Van Gogh - Starry Night - Google Art Project.jpg", "Starry Night Van Gogh Google Art Project", 1600),
    ("vangogh-sunflowers", "Vincent Willem van Gogh 127.jpg", "Van Gogh Sunflowers Neue Pinakothek", 1200),
    ("vangogh-self", "Vincent van Gogh - Self-Portrait - Google Art Project.jpg", "Van Gogh Self-Portrait 1889 Orsay", 1200),
    ("munch-scream", "Edvard Munch, 1893, The Scream, oil, tempera and pastel on cardboard, 91 x 73 cm, National Gallery of Norway.jpg", "The Scream Munch 1893 National Gallery Norway", 1200),
    ("munch-madonna", "Edvard Munch - Madonna - Google Art Project.jpg", "Munch Madonna Google Art Project", 1200),
    ("klimt-kiss", "The Kiss - Gustav Klimt - Google Cultural Institute.jpg", "The Kiss Klimt Google Cultural Institute", 1400),
    ("klimt-adele", "Gustav Klimt 046.jpg", "Adele Bloch-Bauer I Klimt", 1400),
    # ---- Avant-garde ----
    ("kandinsky-comp7", "Vassily Kandinsky, 1913 - Composition 7.jpg", "Kandinsky Composition VII 1913 Tretyakov", 1600),
    ("kandinsky-comp8", "Vassily Kandinsky, 1923 - Composition 8, huile sur toile, 140 cm x 201 cm, Musée Guggenheim, New York.jpg", "Kandinsky Composition 8 1923 Guggenheim", 1600),
    ("mondrian-comp2", "Piet Mondriaan, 1930 - Mondrian Composition II in Red, Blue, and Yellow.jpg", "Mondrian Composition II in Red Blue and Yellow 1930", 1200),
    ("mondrian-boogie", "Piet Mondrian, 1942 - Broadway Boogie Woogie.jpg", "Broadway Boogie Woogie Mondrian", 1200),
    ("malevich-black", "Kazimir Malevich, 1915, Black Suprematic Square, oil on linen canvas, 79.5 x 79.5 cm, Tretyakov Gallery, Moscow.jpg", "Malevich Black Square Tretyakov", 1200),
    ("malevich-supremus", "Suprematist Composition - Kazimir Malevich.jpg", "Malevich Suprematist Composition 1916", 1200),
    ("klee-senecio", "Paul Klee, Senecio, 1922, oil on gauze, 40.3 x 37.4 cm, Kunstmuseum Basel.jpg", "Paul Klee Senecio 1922", 1200),
    ("klee-fish", "Paul Klee - Fish Magic.jpg", "Paul Klee Fish Magic Philadelphia", 1400),
    # ---- 扩充批次（2026-06）----
    # Botticelli
    ("botticelli-magi", "Botticelli - Adoration of the Magi (Zanobi Altar) - Uffizi.jpg", "Botticelli Adoration of the Magi Uffizi 1475", 1600),
    ("botticelli-magnificat", "Sandro Botticelli - Madonna del Magnificat - Google Art Project.jpg", "Madonna del Magnificat Botticelli Uffizi", 1400),
    ("botticelli-pallas", "Sandro Botticelli - Pallade e il centauro - Google Art Project.jpg", "Pallas and the Centaur Botticelli Uffizi", 1200),
    ("botticelli-venusmars", "Venus and Mars - Botticelli - National Gallery.jpg", "Venus and Mars Botticelli National Gallery London", 1700),
    ("botticelli-annunciation", "Sandro Botticelli - Cestello Annunciation - Google Art Project.jpg", "Cestello Annunciation Botticelli Uffizi", 1500),
    ("botticelli-judith", "Sandro Botticelli - The Return of Judith to Bethulia - Google Art Project.jpg", "Return of Judith to Bethulia Botticelli", 1100),
    ("botticelli-pomegranate", "Sandro Botticelli - Madonna della melagrana - Google Art Project.jpg", "Madonna of the Pomegranate Botticelli Uffizi", 1400),
    ("botticelli-simonetta", "Sandro Botticelli - Idealized Portrait of a Lady (Portrait of Simonetta Vespucci as Nymph) - Google Art Project.jpg", "Idealized Portrait of a Lady Simonetta Botticelli Frankfurt", 1100),
    # Da Vinci
    ("davinci-lastsupper", "The Last Supper - Leonardo Da Vinci - High Resolution 32x16.jpg", "Last Supper Leonardo da Vinci Milan restoration", 1800),
    ("davinci-annunciation", "Leonardo da Vinci - Annunciazione - Google Art Project.jpg", "Annunciation Leonardo da Vinci Uffizi", 1800),
    ("davinci-ginevra", "Leonardo da Vinci - Ginevra de' Benci - Google Art Project.jpg", "Ginevra de Benci Leonardo da Vinci Washington", 1200),
    ("davinci-rocks", "Leonardo Da Vinci - Vergine delle Rocce (Louvre).jpg", "Virgin of the Rocks Leonardo Louvre", 1200),
    ("davinci-ferronniere", "Leonardo da Vinci (attrib)- la Belle Ferroniere.jpg", "La Belle Ferronniere Leonardo Louvre", 1200),
    ("davinci-baptist", "Leonardo da Vinci - Saint John the Baptist C2RMF retouched.jpg", "Saint John the Baptist Leonardo Louvre", 1200),
    ("davinci-carnation", "Leonardo da Vinci - Madonna of the Carnation.jpg", "Madonna of the Carnation Leonardo Munich", 1200),
    ("davinci-vitruvian", "Da Vinci Vitruve Luc Viatour.jpg", "Vitruvian Man Leonardo da Vinci", 1200),
    # Vermeer
    ("vermeer-delft", "Vermeer-view-of-delft.jpg", "View of Delft Vermeer Mauritshuis", 1700),
    ("vermeer-letter", "Johannes Vermeer - Girl Reading a Letter by an Open Window - Google Art Project.jpg", "Girl Reading a Letter at an Open Window Vermeer Dresden", 1200),
    ("vermeer-geographer", "Johannes Vermeer - The Geographer - Google Art Project.jpg", "The Geographer Vermeer Frankfurt", 1200),
    ("vermeer-astronomer", "Johannes Vermeer - The Astronomer - 1668.jpg", "The Astronomer Vermeer Louvre", 1200),
    ("vermeer-balance", "Johannes Vermeer - Woman Holding a Balance - Google Art Project.jpg", "Woman Holding a Balance Vermeer Washington", 1200),
    ("vermeer-musiclesson", "Johannes Vermeer - Lady at the Virginal with a Gentleman, 'The Music Lesson' - Google Art Project.jpg", "Music Lesson Vermeer Royal Collection", 1200),
    ("vermeer-officer", "Johannes Vermeer - De Soldaat en het Lachende Meisje - Google Art Project.jpg", "Officer and Laughing Girl Vermeer Frick", 1200),
    ("vermeer-lacemaker", "Johannes Vermeer - The Lacemaker (c.1669-1671).jpg", "The Lacemaker Vermeer Louvre", 1100),
    # Rembrandt
    ("rembrandt-tulp", "Rembrandt - The Anatomy Lesson of Dr Nicolaes Tulp.jpg", "Anatomy Lesson of Dr Nicolaes Tulp Rembrandt Mauritshuis", 1700),
    ("rembrandt-jewishbride", "Rembrandt Harmensz. van Rijn - Portret van een paar als oudtestamentische figuren, genaamd 'Het Joodse bruidje' - Google Art Project.jpg", "Jewish Bride Rembrandt Rijksmuseum", 1700),
    ("rembrandt-syndics", "Rembrandt - De Staalmeesters- het college van staalmeesters (waardijns) van het Amsterdamse lakenbereidersgilde - Google Art Project.jpg", "Syndics of the Drapers Guild Rembrandt Rijksmuseum", 1700),
    ("rembrandt-danae", "Rembrandt Harmensz. van Rijn - Danaë - Google Art Project.jpg", "Danae Rembrandt Hermitage", 1700),
    ("rembrandt-galilee", "Rembrandt Christ in the Storm on the Lake of Galilee.jpg", "Storm on the Sea of Galilee Rembrandt", 1300),
    ("rembrandt-prodigal", "Rembrandt Harmensz van Rijn - Return of the Prodigal Son - Google Art Project.jpg", "Return of the Prodigal Son Rembrandt Hermitage", 1300),
    ("rembrandt-circles", "Rembrandt Self-portrait (Kenwood).jpg", "Self-portrait with Two Circles Rembrandt Kenwood", 1200),
    ("rembrandt-philosopher", "Rembrandt - The Philosopher in Meditation.jpg", "Philosopher in Meditation Rembrandt Louvre", 1200),
    # Monet
    ("monet-parasol", "Claude Monet - Woman with a Parasol - Madame Monet and Her Son - Google Art Project.jpg", "Woman with a Parasol Monet Washington", 1300),
    ("monet-haystacks", "Claude Monet - Meules, fin de l'été - Google Art Project.jpg", "Meules fin de l'été Monet Orsay haystacks", 1500),
    ("monet-rouen", "Claude Monet - Rouen Cathedral, Facade (Sunlight).jpg", "Rouen Cathedral facade sunlight Monet", 1100),
    ("monet-poppies", "Claude Monet 037.jpg", "Poppies Coquelicots Argenteuil Monet Orsay", 1500),
    ("monet-parliament", "Claude Monet, Houses of Parliament, Sunlight Effect (Le Parlement, effet de soleil) - Brooklyn Museum.jpg", "Houses of Parliament Monet sunlight effect", 1300),
    ("monet-lazare", "Claude Monet - The Gare Saint-Lazare - Google Art Project.jpg", "Gare Saint-Lazare Monet", 1400),
    ("monet-magpie", "Claude Monet - The Magpie - Google Art Project.jpg", "The Magpie Monet Orsay", 1600),
    ("monet-japonais", "Claude Monet - Le Bassin aux nymphéas - Google Art Project.jpg", "Water Lily Pond Japanese bridge Monet 1899", 1300),
    ("monet-adresse", "Claude Monet - Jardin à Sainte-Adresse.jpg", "Garden at Sainte-Adresse Monet Metropolitan", 1500),
    ("monet-camille", "Claude Monet - Camille (The Woman in the Green Dress) - Google Art Project.jpg", "Camille Woman in Green Dress Monet Bremen", 1100),
    # Van Gogh
    ("vangogh-bedroom", "Vincent van Gogh - De slaapkamer - Google Art Project.jpg", "Bedroom in Arles Van Gogh Museum", 1500),
    ("vangogh-terrace", "Vincent Willem van Gogh - Cafe Terrace at Night (Yorck).jpg", "Cafe Terrace at Night Van Gogh", 1200),
    ("vangogh-irises", "Irises-Vincent van Gogh.jpg", "Irises Van Gogh Getty", 1500),
    ("vangogh-crows", "Vincent van Gogh - Wheatfield with crows - Google Art Project.jpg", "Wheatfield with Crows Van Gogh Museum", 1700),
    ("vangogh-almond", "Vincent van Gogh - Almond blossom - Google Art Project.jpg", "Almond Blossom Van Gogh Museum", 1600),
    ("vangogh-nightcafe", "Vincent Willem van Gogh - The Night Café - Google Art Project.jpg", "Night Cafe Van Gogh Yale", 1400),
    ("vangogh-potato", "Vincent van Gogh - The potato eaters - Google Art Project (5776925).jpg", "Potato Eaters Van Gogh Museum", 1500),
    ("vangogh-cypresses", "Wheat-Field-with-Cypresses-(1889)-Vincent-van-Gogh-Met.jpg", "Wheat Field with Cypresses Van Gogh Metropolitan", 1500),
    ("vangogh-rhone", "Starry Night Over the Rhone.jpg", "Starry Night Over the Rhone Van Gogh Orsay", 1500),
    ("vangogh-yellowhouse", "Vincent van Gogh - The yellow house ('The street') - Google Art Project.jpg", "Yellow House Van Gogh Museum", 1500),
    ("vangogh-oldman", "Vincent van Gogh - Old man in sorrow (On the Threshold of Eternity).jpg", "At Eternity's Gate Van Gogh Kröller-Müller", 1100),
    # Munch
    ("munch-sickchild", "Edvard Munch - The Sick Child - Google Art Project.jpg", "The Sick Child Munch Nasjonalgalleriet", 1300),
    ("munch-vampire", "Edvard Munch - Vampire (1895) - Google Art Project.jpg", "Vampire Munch 1895", 1300),
    ("munch-anxiety", "Edvard Munch - Anxiety - Google Art Project.jpg", "Anxiety Munch 1894 Munchmuseet", 1100),
    ("munch-dance", "Edvard Munch - The dance of life (1899-1900).jpg", "Dance of Life Munch Nasjonalgalleriet", 1700),
    ("munch-bridge", "Edvard Munch - The Girls on the Bridge (1901).jpg", "Girls on the Bridge Munch 1901", 1200),
    ("munch-despair", "Edvard Munch - Despair (1892).jpg", "Despair Munch 1892", 1100),
    ("munch-sickroom", "Edvard Munch - Death in the Sickroom - Google Art Project.jpg", "Death in the Sickroom Munch", 1300),
    ("munch-cigarette", "Edvard Munch - Self-Portrait with Burning Cigarette - Google Art Project.jpg", "Self-portrait with cigarette Munch 1895", 1100),
    # Klimt
    ("klimt-judith", "Gustav Klimt 039.jpg", "Judith I Klimt Belvedere", 1100),
    ("klimt-danae", "Gustav Klimt 010.jpg", "Danae Klimt 1907", 1300),
    ("klimt-floge", "Gustav Klimt - Portrait of Emilie Louise Flöge.jpg", "Gustav Klimt Emilie Flöge", 1100),
    ("klimt-deathlife", "Gustav Klimt - Death and Life - Google Art Project.jpg", "Death and Life Klimt Leopold", 1600),
    ("klimt-serpents", "Gustav Klimt - Water Serpents I - Google Art Project.jpg", "Water Serpents I Klimt", 1300),
    ("klimt-birch", "Gustav Klimt - Birch Forest - Google Art Project.jpg", "Birch Forest Klimt 1903", 1300),
    ("klimt-hygieia", "Klimt hygeia.jpg", "Klimt Medicine Hygieia detail", 1100),
    ("klimt-maiden", "Gustav Klimt - The Maiden (Die Jungfrau).jpg", "The Virgin Die Jungfrau Klimt Prague", 1500),
    # Kandinsky
    ("kandinsky-blauesreiter", "Wassily Kandinsky, 1903, The Blue Rider (Der Blaue Reiter), oil on canvas, 52.1 x 54.6 cm, Stiftung Sammlung E.G. Bührle, Zurich.jpg", "Blue Rider Kandinsky 1903", 1300),
    ("kandinsky-comp4", "Vassily Kandinsky, 1911 - Composition No 4.jpg", "Kandinsky Composition IV 1911", 1600),
    ("kandinsky-improv28", "Vassily Kandinsky, 1912 - Improvisation 28 (second version).jpg", "Improvisation 28 Kandinsky Guggenheim", 1600),
    ("kandinsky-yrb", "Vassily Kandinsky, 1925 - Jaune Rouge Bleu.jpg", "Yellow Red Blue Kandinsky Pompidou", 1700),
    ("kandinsky-circles", "Vassily Kandinsky, 1926 - Several Circles, Gugg 0910 25.jpg", "Several Circles Kandinsky Guggenheim", 1400),
    ("kandinsky-onwhite", "Vassily Kandinsky, 1923 - On White II.jpg", "On White II Kandinsky Pompidou", 1400),
    ("kandinsky-transverse", "Vassily Kandinsky, 1923 - Transverse Line.jpg", "Kandinsky Querlinie 1923", 1500),
    ("kandinsky-impression3", "Vassily Kandinsky, 1911 - Impression III (Concert).jpg", "Impression III Konzert Kandinsky Lenbachhaus", 1500),
    # Mondrian
    ("mondrian-redtree", "Piet Mondriaan - Avond (Evening)- The Red Tree - Google Art Project.jpg", "Evening Red Tree Mondrian Gemeentemuseum", 1400),
    ("mondrian-graytree", "Mondrian - The Gray Tree - 1911.jpg", "Gray Tree Mondrian 1911", 1400),
    ("mondrian-pier", "Piet Mondriaan, 1915 - Compositie 10 in zwart wit.jpg", "Composition 10 Pier and Ocean Mondrian", 1400),
    ("mondrian-mill", "Piet Mondriaan, 1908 - Molen bij zonlicht.jpg", "Mill in Sunlight Mondrian Gemeentemuseum", 1200),
    ("mondrian-tableau1", "Piet Mondriaan, 1921 - Tableau I.jpg", "Mondrian Tableau I", 1200),
    ("mondrian-compa", "Piet Mondriaan, 1920 - Composition A.jpg", "Composition A Mondrian 1920", 1300),
    ("mondrian-farm", "Piet Mondrian - Farm near Duivendrecht - Google Art Project.jpg", "Farm near Duivendrecht Mondrian Chicago", 1400),
    ("mondrian-ny", "Piet Mondrian - New York City I (1942).jpg", "New York City I Mondrian Pompidou", 1200),
    # Malevich
    ("malevich-white", "Kazimir Malevich - 'Suprematist Composition- White on White', oil on canvas, 1918, Museum of Modern Art.jpg", "White on White Malevich MoMA", 1200),
    ("malevich-redsquare", "Kazimir Malevich - Red Square - Google Art Project.jpg", "Red Square Malevich Russian Museum", 1100),
    ("malevich-circle", "Kazimir Malevich - Black Circle - Google Art Project.jpg", "Black Circle Malevich Russian Museum", 1600),
    ("malevich-cross", "Kazimir Malevich, 1915, Black Cross, oil on canvas, Centre Pompidou.jpg", "Black Cross Malevich Pompidou", 1600),
    ("malevich-grinder", "Kazimir Malevich - The Knife Grinder - Google Art Project.jpg", "Knife Grinder Malevich", 1200),
    ("malevich-morning", "Kazimir Malevich - Morning in the Village after Snowstorm - Google Art Project.jpg", "Morning in the Village after Snowstorm Malevich Guggenheim", 1300),
    ("malevich-aviator", "Kazimir Malevich - The Aviator - Google Art Project.jpg", "Aviator Malevich Russian Museum 1914", 1100),
    ("malevich-supremus56", "Kazimir Malevich - Suprematism. Supremus No. 56 - Google Art Project.jpg", "Malevich Suprematism Supremus", 1300),
    # Klee
    ("klee-twittering", "Paul Klee, 1922, Twittering Machine (Die Zwitscher-Maschine), watercolor and ink, Museum of Modern Art.jpg", "Zwitscher-Maschine Klee", 1100),
    ("klee-castle", "Paul Klee, 1928 - Castle and Sun.jpg", "Castle and Sun Klee 1928", 1400),
    ("klee-balloon", "Paul Klee, 1922 - Red Balloon.jpg", "Red Balloon Klee Guggenheim", 1200),
    ("klee-catbird", "Paul Klee, 1928 - Cat and Bird.jpg", "Cat and Bird Klee MoMA", 1300),
    ("klee-parnassum", "Paul Klee, Ad Parnassum, 1932, Kunstmuseum Bern.jpg", "Ad Parnassum Klee", 1500),
    ("klee-highways", "Paul Klee, Hauptweg und Nebenwege, 1929, Museum Ludwig.jpg", "Hauptweg und Nebenwege Klee Ludwig", 1300),
    ("klee-deathfire", "Paul Klee, 1940 - Death and Fire.jpg", "Tod und Feuer Klee", 1300),
    ("klee-goldfish", "Paul Klee - The Goldfish - Google Art Project.jpg", "The Goldfish Klee Hamburger Kunsthalle", 1400),
    ("klee-angelus", "Klee, paul, angelus novus, 1920.jpg", "Angelus Novus Klee", 1100),
    ("klee-insula", "Paul Klee, Insula dulcamara, 1938, Zentrum Paul Klee.jpg", "Insula dulcamara Klee", 1600),
]


def curl(url, *extra):
    cmd = ["curl", "-sL", "--max-time", "120", "-A", UA, url, *extra]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        raise RuntimeError("curl failed: %s" % res.stderr.decode()[:200])
    return res.stdout


def api(params):
    from urllib.parse import urlencode
    qs = urlencode({**params, "format": "json"})
    # Commons 对连续请求会限流（返回空体）：重试 + 指数退避
    for attempt, delay in enumerate((0, 3, 8, 20)):
        if delay:
            time.sleep(delay)
        raw = curl(API + "?" + qs).decode("utf-8")
        if raw.strip():
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                continue
    raise RuntimeError("API kept returning empty/invalid response")


def metadata_value(extmetadata, key):
    """Return the value Commons supplied for one extmetadata field."""
    field = extmetadata.get(key, {})
    if not isinstance(field, dict):
        return ""
    value = field.get("value", "")
    return "" if value is None else str(value).strip()


def license_is_allowed(short_name):
    """Keep the policy intentionally narrow; variants with SA/NC are rejected."""
    normalized = " ".join(short_name.replace("\u00a0", " ").split()).lower()
    return normalized in {
        "public domain",
        "cc0",
        "cc0 1.0",
        "cc0 1.0 universal",
        "cc by 1.0",
        "cc by 2.0",
        "cc by 2.5",
        "cc by 3.0",
        "cc by 4.0",
    }


def commons_file_info(file_title, width):
    """Resolve one candidate and return its image + license metadata."""
    query_title = file_title if file_title.startswith("File:") else "File:" + file_title
    data = api({
        "action": "query",
        "prop": "imageinfo",
        "redirects": 1,
        "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": width,
        "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit",
        "iiextmetadatalanguage": "en",
        "titles": query_title,
    })
    pages = data.get("query", {}).get("pages", {})
    for page_id, page in pages.items():
        if page_id == "-1" or "missing" in page or not page.get("imageinfo"):
            return None, "missing Commons file"

        imageinfo = page["imageinfo"][0]
        mime = imageinfo.get("mime", "")
        if mime != "image/jpeg":
            return None, "not a JPEG (%s)" % (mime or "unknown MIME")

        extmetadata = imageinfo.get("extmetadata", {})
        license_short_name = metadata_value(extmetadata, "LicenseShortName")
        if not license_is_allowed(license_short_name):
            return None, "license rejected (%s)" % (license_short_name or "unknown")

        description_url = imageinfo.get("descriptionurl", "")
        if not description_url:
            return None, "missing canonical description URL"

        artist = metadata_value(extmetadata, "Artist")
        credit = metadata_value(extmetadata, "Credit")
        license_url = metadata_value(extmetadata, "LicenseUrl")
        if license_short_name.lower().startswith("cc by"):
            if not (artist or credit):
                return None, "CC BY file has no Artist/Credit metadata"
            if not license_url:
                return None, "CC BY file has no LicenseUrl metadata"

        download_url = imageinfo.get("thumburl") or imageinfo.get("url")
        if not download_url:
            return None, "missing image URL"

        return {
            "commonsFileTitle": page.get("title", query_title),
            "canonicalDescriptionUrl": description_url,
            "licenseShortName": license_short_name,
            "licenseUrl": license_url,
            "artist": artist,
            "credit": credit,
            "sourceMime": mime,
            "sourceWidth": imageinfo.get("width"),
            "sourceHeight": imageinfo.get("height"),
            "thumbnailWidth": imageinfo.get("thumbwidth", imageinfo.get("width")),
            "thumbnailHeight": imageinfo.get("thumbheight", imageinfo.get("height")),
            "_downloadUrl": download_url,
        }, None
    return None, "missing Commons file"


def search_file_titles(query):
    """Return JPEG candidates; callers must inspect every candidate's license."""
    data = api({
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srnamespace": 6,
        "srlimit": SEARCH_LIMIT,
    })
    return [
        hit["title"]
        for hit in data.get("query", {}).get("search", [])
        if hit.get("title", "").lower().endswith((".jpg", ".jpeg"))
    ]


def select_source(work, previous_entry):
    """Choose the first candidate that passes image and license validation."""
    _, exact_title, fallback, width = work
    previous_title = (previous_entry or {}).get("commonsFileTitle", "")
    candidates = []
    if previous_title:
        candidates.append((previous_title, "manifest"))
    candidates.append((exact_title, "exact"))

    attempted = set()
    rejected = []

    def inspect(candidate_title, method):
        key = candidate_title.casefold()
        if key in attempted:
            return None
        attempted.add(key)
        info, reason = commons_file_info(candidate_title, width)
        if info:
            return info, method
        rejected.append("%s: %s" % (candidate_title, reason))
        return None

    for candidate_title, method in candidates:
        accepted = inspect(candidate_title, method)
        if accepted:
            return accepted[0], accepted[1], rejected

    # Search order is only a discovery hint. Every result gets a full metadata
    # query, so an attractive first hit cannot bypass the license policy.
    for candidate_title in search_file_titles(fallback):
        accepted = inspect(candidate_title, "search")
        if accepted:
            return accepted[0], accepted[1], rejected

    return None, None, rejected


def local_file_summary(path):
    if not os.path.isfile(path) or os.path.getsize(path) < MIN_FILE_BYTES:
        return None
    digest = hashlib.sha256()
    first_bytes = b""
    with open(path, "rb") as local_file:
        for chunk in iter(lambda: local_file.read(1024 * 1024), b""):
            if not first_bytes:
                first_bytes = chunk[:3]
            digest.update(chunk)
    if first_bytes != b"\xff\xd8\xff":
        return None
    return {
        "bytes": os.path.getsize(path),
        "sha256": digest.hexdigest(),
    }


def download_jpeg(url, destination):
    blob = curl(url)
    if len(blob) < MIN_FILE_BYTES:
        raise RuntimeError("file too small (%d bytes)" % len(blob))
    if not blob.startswith(b"\xff\xd8\xff"):
        raise RuntimeError("download is not a JPEG")

    file_descriptor, temp_path = tempfile.mkstemp(
        prefix=".%s." % os.path.basename(destination),
        dir=os.path.dirname(destination),
    )
    try:
        with os.fdopen(file_descriptor, "wb") as temp_file:
            temp_file.write(blob)
        os.replace(temp_path, destination)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    return {
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
    }


def manifest_entry(work_id, source, local_summary):
    return {
        "workId": work_id,
        "localPath": "public/art/%s.jpg" % work_id,
        "bytes": local_summary["bytes"],
        "sha256": local_summary["sha256"],
        "commonsFileTitle": source["commonsFileTitle"],
        "canonicalDescriptionUrl": source["canonicalDescriptionUrl"],
        "licenseShortName": source["licenseShortName"],
        "licenseUrl": source["licenseUrl"],
        "artist": source["artist"],
        "credit": source["credit"],
        "sourceMime": source["sourceMime"],
        "sourceWidth": source["sourceWidth"],
        "sourceHeight": source["sourceHeight"],
    }


def empty_manifest():
    return {
        "schemaVersion": 1,
        "generatedBy": "scripts/fetch_art.py",
        "licensePolicy": {
            "accepted": ["Public domain", "CC0", "CC BY <version>"],
            "rejected": ["CC BY-SA", "CC BY-NC", "unknown/missing"],
        },
        "files": {},
    }


def load_manifest(path):
    if not os.path.exists(path):
        return empty_manifest()
    with open(path, "r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("files"), dict):
        raise RuntimeError("unsupported or malformed manifest: %s" % path)
    return manifest


def write_manifest(path, manifest):
    """Write deterministic JSON atomically so interrupted runs stay reviewable."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    manifest["files"] = dict(sorted(manifest["files"].items()))
    file_descriptor, temp_path = tempfile.mkstemp(
        prefix=".%s." % os.path.basename(path),
        dir=os.path.dirname(os.path.abspath(path)),
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as temp_file:
            json.dump(manifest, temp_file, ensure_ascii=False, indent=2)
            temp_file.write("\n")
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def fetch(work, previous_entry, metadata_only=False):
    work_id, _, _, _ = work
    output_path = os.path.join(OUT_DIR, work_id + ".jpg")
    current_local = local_file_summary(output_path)
    if metadata_only and not current_local:
        return "skip", work_id, "no existing JPEG", None

    source, selection_method, rejected = select_source(work, previous_entry)
    if source is None:
        detail = "; ".join(rejected[:3]) or "no Commons candidates"
        return "FAIL", work_id, detail[:240], None

    previous_title = (previous_entry or {}).get("commonsFileTitle", "")
    previous_hash = (previous_entry or {}).get("sha256", "")
    reuse_existing = bool(current_local) and (
        (selection_method == "manifest" and previous_hash == current_local["sha256"])
        or (selection_method == "exact" and not previous_title)
    )

    if not reuse_existing:
        if metadata_only:
            return (
                "FAIL",
                work_id,
                "existing file source is ambiguous; rerun without --metadata-only to replace it safely",
                None,
            )
        current_local = download_jpeg(source["_downloadUrl"], output_path)
        status = "ok"
    else:
        status = "meta"

    entry = manifest_entry(work_id, source, current_local)
    message = "%s  %dKB  %s  <- %s" % (
        source["licenseShortName"],
        current_local["bytes"] // 1024,
        "metadata refreshed" if status == "meta" else "downloaded",
        source["commonsFileTitle"],
    )
    return status, work_id, message, entry


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="refresh provenance for existing JPEGs without downloading missing works",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="WORK_ID",
        help="process one work ID (repeat to process several)",
    )
    parser.add_argument(
        "--manifest",
        default=MANIFEST_PATH,
        help="manifest path (default: public/art/sources.manifest.json)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = load_manifest(args.manifest)
    write_manifest(args.manifest, manifest)

    requested = set(args.only)
    known_ids = {work[0] for work in WORKS}
    unknown_ids = sorted(requested - known_ids)
    if unknown_ids:
        raise SystemExit("unknown work ID(s): %s" % ", ".join(unknown_ids))
    selected_works = [work for work in WORKS if not requested or work[0] in requested]

    failures = 0
    for work in selected_works:
        manifest_key = work[0] + ".jpg"
        try:
            status, work_id, message, entry = fetch(
                work,
                manifest["files"].get(manifest_key),
                metadata_only=args.metadata_only,
            )
            if entry:
                manifest["files"][manifest_key] = entry
                write_manifest(args.manifest, manifest)
        except Exception as exc:  # noqa: BLE001
            status, work_id, message = "FAIL", work[0], str(exc)[:240]
        if status == "FAIL":
            failures += 1
        if status != "skip":
            time.sleep(0.8)  # 礼貌限速
        print("[%s] %-22s %s" % (status, work_id, message), flush=True)

    print(
        "done. failures=%d manifest=%s entries=%d"
        % (failures, args.manifest, len(manifest["files"]))
    )
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
