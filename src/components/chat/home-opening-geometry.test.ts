import { describe, expect, it } from "vitest";
import { HOME_OPENING_END, openingPose, projectOpening, readOpeningPlanes, settleOpening } from "./home-opening-geometry";

describe("home opening vector geometry",()=>{
  const planes=readOpeningPlanes();
  it("returns to the canonical logo coordinates without changing its silhouette",()=>{
    const result=projectOpening(planes,HOME_OPENING_END,{x:107,y:68});
    expect(result.map(face=>face.name).sort()).toEqual(["fold","left","right"]);
    // Canonical left path begins at (35,34) in the 400-unit asset, shown at 32px.
    expect(result.find(face=>face.name==="left")!.front).toMatch(/^M93\.800 54\.720C/);
    expect(result.find(face=>face.name==="fold")!.front).toMatch(/^M105\.400 53\.920C/);
  });
  it("keeps every frame finite and contained, including the edge-on fold",()=>{
    for(let frame=0;frame<=264;frame++) {
      const result=projectOpening(planes,openingPose(frame/264),{x:107,y:68});
      for(const face of result) {
        expect(face.front).not.toMatch(/NaN|Infinity/);
        expect(face.edge).not.toMatch(/NaN|Infinity/);
        const values=(face.front.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
        for(let index=0;index<values.length;index+=2) {
          expect(values[index]).toBeGreaterThan(0);
          expect(values[index]).toBeLessThan(320);
          expect(values[index+1]).toBeGreaterThan(0);
          expect(values[index+1]).toBeLessThan(136);
        }
      }
    }
  });
  it("interrupts by interpolating to rest instead of replaying later opening poses",()=>{
    const early=openingPose(.15);
    expect(settleOpening(early,0)).toEqual(early);
    const middle=settleOpening(early,.5);
    expect(middle.land).toBeGreaterThan(.8);
    expect(middle.identity).toBeGreaterThan(.8);
    expect(settleOpening(early,1)).toEqual(HOME_OPENING_END);
  });
});
