import outfit from "../video-agent/assets/previews/replicate-output-5.40s.webp";
import tee from "../video-agent/assets/previews/image-motion-output-7.30s.webp";
import toys from "../video-agent/assets/previews/talking-output-1.05s.webp";
import drinkware from "../video-agent/assets/previews/ad-output-6.65s.webp";

export const features = [
  { id: "discover", title: "筛选达人", copy: "按内容方向缩小名单，对照近期作品与平均播放量，判断谁适合展示你的商品。" },
  { id: "invite", title: "合作邀约", copy: "从对方的一条作品说起，写清合作商品、拍摄想法和佣金。中英文邀约可以分别调整。" },
  { id: "samples", title: "寄样跟进", copy: "把回复、寄样和发布记在一条时间线上。样品寄出后，下一次联系就从交付进度谈起。" },
  { id: "review", title: "效果复盘", copy: "将内容带来的订单和成交额，与寄样、运费及佣金放在一起比较，决定下一轮优先和谁合作。" },
] as const;

export const workPreviews = {
  style: [
    { title: "通勤衣橱", photo: outfit, alt: "创作者在镜前展示通勤穿搭", position: "50% 5%", views: "2.2 万" },
    { title: "基础款试衣间", photo: tee, alt: "创作者演示基础短袖的上身效果", position: "50% 4%", views: "1.6 万" },
  ],
  home: [
    { title: "日常开箱", photo: toys, alt: "创作者出镜讲解毛绒玩偶", position: "50% 11%", views: "1.8 万" },
    { title: "餐桌实测", photo: drinkware, alt: "玻璃杯注水实测的作品片段", position: "50% 57%", views: "1.3 万" },
  ],
} as const;

export const invitation = {
  en: { greeting: "Hi Mia,", text: "I enjoyed your morning coffee video. Would you film a pour with our stoneware cup? We can send a sample and offer 15% commission on sales." },
  zh: { greeting: "Mia，你好。", text: "看了你拍的晨间咖啡视频，想请你用我们的陶杯拍一段手冲。我们寄送样品，成交佣金为 15%。你有兴趣吗？" },
};

// Illustrative 30-day cohorts. Monetary amounts are in whole USD.
export const reviewRounds = [
  { label: "首轮", orders: 18, sales: 1080, sampling: 198, commission: 162 },
  { label: "复投", orders: 28, sales: 1680, sampling: 168, commission: 252 },
] as const;
