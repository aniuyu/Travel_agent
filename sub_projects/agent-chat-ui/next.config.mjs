/** @type {import('next').NextConfig} */
const nextConfig = {
  // 关闭开发模式下左下角的 Next.js 开发者指示器（黑色圆形 "N" 徽标）。
  // 它是 fixed 定位的悬浮球，正好压在侧边栏底部用户卡片的头像上，
  // 很容易被误认为是页面上的元素。仅影响 dev，生产构建本来就不显示。
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
