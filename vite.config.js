import { defineConfig } from 'vite';

// 分享卡片（og:image / og:url）要用绝对地址，各社交平台才抓得到封面。
// 站点地址按顺序取：SITE_URL（手动或 CI 设置）→ Vercel 生产域名 → 都没有就保留相对路径。
function siteUrl() {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = process.env.SITE_URL || (vercel ? `https://${vercel}` : '');
  return url ? url.replace(/\/?$/, '/') : '';
}

function socialMeta() {
  return {
    name: 'musewalk-social-meta',
    transformIndexHtml(html) {
      const base = siteUrl();
      if (!base) return html;
      return {
        html: html.replaceAll('content="./og-cover.jpg"', `content="${base}og-cover.jpg"`),
        tags: [{ tag: 'meta', attrs: { property: 'og:url', content: base }, injectTo: 'head' }],
      };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [socialMeta()],
  server: {
    port: 5173,
    strictPort: true, // 端口固定，本地链接不漂移
    host: '127.0.0.1',
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
