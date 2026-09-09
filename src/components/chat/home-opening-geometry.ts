import logoSource from "../../assets/brand/yijie-mark.svg?raw";

type Point = { x: number; y: number; z: number };
type Curve = readonly [Point, Point, Point, Point];
type Plane = { name: "left" | "right" | "fold"; curves: Curve[]; pivot: Point };
export type OpeningPose = {
  reveal: number; unfold: number; face: number; land: number; opening: number;
  fold: number; thickness: number; light: number; lightPosition: number;
  identity: number; copy: number;
};
export type OpeningFace = { name: Plane["name"]; front: string; edge: string; depth: number };
export const HOME_OPENING_DURATION = 2200;
export const HOME_OPENING_SETTLE = 160;
export const HOME_OPENING_END: OpeningPose = {
  reveal: 1, unfold: 1, face: 1, land: 1, opening: 1, fold: 1,
  thickness: 0, light: 0, lightPosition: 1, identity: 1, copy: 1,
};

const point = (x: number, y: number, z = 0): Point => ({ x, y, z });
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const between = (a: Point, b: Point, t: number): Point => point(mix(a.x,b.x,t), mix(a.y,b.y,t), mix(a.z,b.z,t));
const smooth = (x: number): number => x * x * (3 - 2 * x);
const out = (x: number): number => 1 - (1 - x) ** 3;
const range = (x: number, start: number, end: number): number => Math.max(0, Math.min(1, (x-start)/(end-start)));

export function openingPose(progress: number): OpeningPose {
  const t = Math.max(0, Math.min(1, progress)) * 2600;
  const face = smooth(range(t,900,1430));
  return {
    reveal: out(range(t,0,260)), unfold: smooth(range(t,260,1050)), face,
    land: smooth(range(t,1660,2290)), opening: smooth(range(t,240,740)),
    fold: smooth(range(t,190,930)), thickness: 1-smooth(range(t,1700,2230)),
    light: Math.sin(Math.PI*range(t,480,1320)) * (1-face*.65),
    lightPosition: range(t,450,1350), identity: out(range(t,1870,2340)),
    copy: out(range(t,2160,2580)),
  };
}

/** Interpolate directly to rest when interrupted; never fast-forward the remaining choreography. */
export function settleOpening(from: OpeningPose, progress: number): OpeningPose {
  const result = { ...HOME_OPENING_END };
  const eased = out(Math.max(0, Math.min(1, progress)));
  for (const key of Object.keys(result) as (keyof OpeningPose)[]) result[key] = mix(from[key], HOME_OPENING_END[key], eased);
  return result;
}

function split([a,b,c,d]: Curve): [Curve, Curve] {
  const ab=between(a,b,.5), bc=between(b,c,.5), cd=between(c,d,.5);
  const abc=between(ab,bc,.5), bcd=between(bc,cd,.5), middle=between(abc,bcd,.5);
  return [[a,ab,abc,middle],[middle,bcd,cd,d]];
}

/** Read only the absolute commands used by the canonical brand asset. Keep curves as curves. */
function readCurves(path: string): Curve[] {
  const tokens = path.match(/[a-z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const result: Curve[] = [];
  let index=0, command="", current=point(0,0), start=current;
  const number=(): number => {
    const value=Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error("Invalid canonical logo coordinate");
    return value;
  };
  const next=(): Point => point(number(),number());
  const line=(end: Point): void => {
    result.push([current,between(current,end,1/3),between(current,end,2/3),end]); current=end;
  };
  while (index<tokens.length) {
    if (/^[a-z]$/i.test(tokens[index]!)) command=tokens[index++]!;
    switch(command) {
      case "M": current=next(); start=current; command="L"; break;
      case "L": line(next()); break;
      case "H": line(point(number(),current.y)); break;
      case "V": line(point(current.x,number())); break;
      case "C": { const b=next(), c=next(), end=next(); result.push([current,b,c,end]); current=end; break; }
      case "Q": { const control=next(), end=next(); result.push([current,between(current,control,2/3),between(end,control,2/3),end]); current=end; break; }
      case "Z": if(current.x!==start.x || current.y!==start.y) line(start); command=""; break;
      default: throw new Error("Unsupported canonical logo command");
    }
  }
  // Two subdivisions preserve cubic contours while keeping perspective approximation subpixel.
  return result.flatMap(curve => split(curve).flatMap(split));
}

export function readOpeningPlanes(source = logoSource): Plane[] {
  const paths=[...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match=>match[1]!);
  if (paths.length!==3) throw new Error("The opening requires the three canonical logo planes");
  return [
    { name:"left", curves:readCurves(paths[0]!), pivot:point(232,180) },
    { name:"right", curves:readCurves(paths[1]!), pivot:point(280,172) },
    { name:"fold", curves:readCurves(paths[2]!), pivot:point(280,152) },
  ];
}

function rotate(p: Point, axis: "x" | "y" | "z", degrees: number): Point {
  const angle=degrees*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  if(axis==="x") return point(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
  if(axis==="y") return point(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);
  return point(p.x*c-p.y*s,p.x*s+p.y*c,p.z);
}
const coordinates=(p: Point): string => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
const cubic=(curve: Curve): string => `C${coordinates(curve[1])} ${coordinates(curve[2])} ${coordinates(curve[3])}`;
const outline=(curves: Curve[]): string => `M${coordinates(curves[0]![0])}${curves.map(cubic).join("")}Z`;

export function projectOpening(
  planes: Plane[], pose: OpeningPose, target: { x: number; y: number },
  sizes: { peak: number; rest: number } = { peak:80, rest:32 },
): OpeningFace[] {
  const size=mix(mix(sizes.peak*.8,sizes.peak,pose.unfold),sizes.rest,pose.land)/400;
  const center=point(mix(160,target.x,pose.land), mix(68+mix(4,-8,pose.unfold),target.y,pose.land));
  return planes.map(plane => {
    const project=(original: Point, depth: number): Point => {
      let p=point(original.x-plane.pivot.x,original.y-plane.pivot.y,depth);
      if(plane.name==="fold") p=rotate(p,"x",mix(-80,0,pose.fold));
      else {
        p=rotate(p,"z",mix(plane.name==="left" ? -6 : 6,0,pose.unfold));
        p=rotate(p,"y",mix(plane.name==="left" ? -67 : 72,0,pose.unfold));
      }
      p=point(p.x+plane.pivot.x-200,p.y+plane.pivot.y-200,p.z);
      p=rotate(p,"z",mix(mix(-32,-8,pose.unfold),0,pose.face));
      p=rotate(p,"y",mix(mix(-30,-17,pose.unfold),0,pose.face));
      p=rotate(p,"x",mix(mix(77,18,pose.unfold),0,pose.face));
      const perspective=2364/(2364-p.z);
      const screen=rotate(point(p.x*perspective*mix(.035,1,pose.opening),p.y*perspective),"z",mix(-18,0,pose.opening));
      return point(center.x+screen.x*size,center.y+screen.y*size,p.z);
    };
    const front=plane.curves.map(curve=>curve.map(p=>project(p,0)) as unknown as Curve);
    const back=plane.curves.map(curve=>curve.map(p=>project(p,-18*pose.thickness)) as unknown as Curve);
    // Continuous cubic side walls replace the prototype's six offset raster-mask copies.
    const walls=front.map((curve,index)=>{
      const rear=back[index]!;
      return `M${coordinates(curve[0])}${cubic(curve)}L${coordinates(rear[3])}C${coordinates(rear[2])} ${coordinates(rear[1])} ${coordinates(rear[0])}Z`;
    }).join("");
    return {
      name:plane.name, front:outline(front), edge:outline(back)+walls,
      depth:front.reduce((sum,curve)=>sum+curve[0].z,0)/front.length,
    };
  }).sort((a,b)=>a.depth-b.depth);
}
