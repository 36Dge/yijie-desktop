export const campaign = {
  product: "灰棕编织手提包",
  commissionPercent: 15,
  unitPriceCents: 5400,
  sampleAndShippingCents: 3000,
} as const;

export const stages = ["candidate", "invited", "replied", "sampled", "published"] as const;
export type Stage = typeof stages[number];
export type Language = "en" | "zh";
export const stageLabels: Record<Stage, string> = {
  candidate: "待邀约", invited: "待回复", replied: "待寄样", sampled: "待发布", published: "已发布",
};
export const eventLabels = { invited: "已登记邀约", replied: "已收到回复", sampled: "已寄出样品", published: "内容已发布" } as const;

type RecordedStage = keyof typeof eventLabels;
export interface ContactEvent { stage: RecordedStage; when: string; message?: string }
export interface Creator {
  id: string;
  name: string;
  topic: "通勤穿搭" | "包袋测评" | "日常收纳";
  followers: number;
  avgViews30d: number;
  recentPost: string;
  opening: Record<Language, string>;
  history: ContactEvent[];
  drafts: Partial<Record<`${"candidate" | "invited"}-${Language}`, string>>;
  attributedOrders?: number;
}

const directory: Omit<Creator, "drafts">[] = [
  { id: "jules", name: "Jules Park", topic: "通勤穿搭", followers: 86400, avgViews30d: 21800,
    recentPost: "一件西装的五天通勤穿法",
    opening: { en: "I saw your five-day blazer series.", zh: "看了你用一件西装搭配五天通勤装的视频。" },
    history: [] },
  { id: "morgan", name: "Morgan Lee", topic: "包袋测评", followers: 52700, avgViews30d: 17400,
    recentPost: "小号通勤包能装下什么",
    opening: { en: "Your work-bag test made it easy to see what actually fits.", zh: "你把日常物件逐件放进通勤包的测评，让包的大小很好判断。" },
    history: [{ stage: "invited", when: "11/25" }] },
  { id: "nora", name: "Nora Ellis", topic: "日常收纳", followers: 34800, avgViews30d: 10600,
    recentPost: "下班去健身，我的包里有什么",
    opening: { en: "Your desk-to-gym packing video gave me a good sense of what you carry every day.", zh: "你那条从办公室去健身房的收纳视频，把随身物件拍得很清楚。" },
    history: [{ stage: "invited", when: "11/21" }, { stage: "replied", when: "11/24" }] },
  { id: "tess", name: "Tess Moore", topic: "通勤穿搭", followers: 112000, avgViews30d: 28500,
    recentPost: "秋冬大衣与肩背包的搭配",
    opening: { en: "I noticed how you showed the shoulder strap over a winter coat.", zh: "你的大衣搭配视频特意拍了肩带的落点，这正是我们想展示的细节。" },
    history: [{ stage: "invited", when: "11/17" }, { stage: "replied", when: "11/19" }, { stage: "sampled", when: "11/22" }] },
  { id: "ella", name: "Ella Chen", topic: "包袋测评", followers: 69300, avgViews30d: 19200,
    recentPost: "从工位走到街头的编织包试背",
    opening: { en: "The close-ups in your woven-bag review showed the texture beautifully.", zh: "你在试背视频里保留了编织纹理的近景，很适合这个包。" },
    history: [{ stage: "invited", when: "11/10" }, { stage: "replied", when: "11/12" }, { stage: "sampled", when: "11/15" }, { stage: "published", when: "11/23" }],
    attributedOrders: 24 },
];

export function newContacts(): Creator[] {
  return directory.map(person => ({ ...person, history: [...person.history], drafts: {} }));
}

export function stageOf(person: Creator): Stage {
  return person.history[person.history.length - 1]?.stage ?? "candidate";
}

export function draftFor(person: Creator, stage: "candidate" | "invited", language: Language): string {
  const saved = person.drafts[`${stage}-${language}`];
  if (saved !== undefined) return saved;
  const name = person.name.split(" ")[0];
  const rate = campaign.commissionPercent + "%";
  if (stage === "invited") return language === "en"
    ? `Hi ${name}, following up on the woven work bag. The offer includes a sample and ${rate} commission. Would you like the brief?`
    : `${name}，你好。想再问问你对这款通勤包有没有兴趣。如果合适，我们可以寄出样品和拍摄简报，合作订单的佣金是 ${rate}。`;
  return language === "en"
    ? `Hi ${name},\n\n${person.opening.en} Would you try our taupe woven bag and film what fits inside, then show it on your shoulder? We'll send a sample and offer ${rate} commission on attributed sales.`
    : `${name}，你好。\n\n${person.opening.zh} 想请你试试我们的${campaign.product}，拍一段装包和上肩的短片。我们寄送样品，成交佣金是 ${rate}。你有兴趣吗？`;
}

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
});
const audienceFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export const audience = (n: number) => audienceFormat.format(n / 10000) + " 万";

export function outcomes(people: Creator[]) {
  const count = (stage: RecordedStage) => people.filter(person => person.history.some(event => event.stage === stage)).length;
  const invited = count("invited"), replied = count("replied"), sampled = count("sampled"), published = count("published");
  const attributed = people.filter(person => stageOf(person) === "published" && person.attributedOrders !== undefined);
  const orders = attributed.reduce((sum, person) => sum + (person.attributedOrders ?? 0), 0);
  const revenue = orders * campaign.unitPriceCents;
  const commission = Math.round(revenue * campaign.commissionPercent / 100);
  const samples = sampled * campaign.sampleAndShippingCents;
  const cost = commission + samples;
  return { invited, replied, sampled, published, attributed: attributed.length, orders, revenue, commission, samples, cost,
    replyRate: invited ? Math.round(replied / invited * 100) + "%" : "—",
    returnRatio: cost && attributed.length ? (revenue / cost).toFixed(2) + "×" : "—" };
}
