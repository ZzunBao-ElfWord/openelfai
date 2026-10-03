/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：构建产物为纯静态文件（out/ 目录），可直接部署到对象存储 + CDN，无需服务器
  output: 'export',
  // 目录式 URL（/tools/doubao/），与对象存储静态托管的 index.html 约定一致
  trailingSlash: true,
  // 静态导出不使用 Next 图片优化服务
  images: { unoptimized: true }
};

export default nextConfig;
