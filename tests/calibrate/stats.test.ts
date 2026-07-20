import { describe, expect, it } from "vitest";
import { pearson, rank, spearman } from "../../src/calibrate/stats.js";

describe("pearson", () => {
  it("returns 1 for a perfect positive linear relationship", () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1);
  });

  it("returns -1 for a perfect negative linear relationship", () => {
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1);
  });

  it("matches a hand-computed value", () => {
    // x=[1,2,3,4], y=[2,4,5,4]
    //   dx=[-1.5,-0.5,0.5,1.5], dy=[-1.75,0.25,1.25,0.25]
    //   cov=3.5, varX=5, varY=4.75 → r = 3.5/sqrt(23.75) = 0.7181848
    expect(pearson([1, 2, 3, 4], [2, 4, 5, 4])).toBeCloseTo(0.7181848, 6);
  });

  it("returns null for constant series (zero variance) and short input", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
    expect(pearson([1, 2], [1])).toBeNull();
  });
});

describe("rank", () => {
  it("averages tied ranks", () => {
    expect(rank([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("ranks unsorted input by value, preserving position", () => {
    expect(rank([30, 10, 20])).toEqual([3, 1, 2]);
  });

  it("handles all-equal input", () => {
    expect(rank([5, 5, 5])).toEqual([2, 2, 2]);
  });
});

describe("spearman", () => {
  it("returns 1 for a monotonic but non-linear relationship", () => {
    // y = x^3 is monotonic: Pearson < 1, Spearman == 1
    const x = [1, 2, 3, 4, 5];
    const y = [1, 8, 27, 64, 125];
    expect(spearman(x, y)).toBeCloseTo(1);
    expect(pearson(x, y)!).toBeLessThan(1);
  });

  it("returns -1 for a perfectly decreasing relationship", () => {
    expect(spearman([1, 2, 3, 4], [9, 7, 5, 1])).toBeCloseTo(-1);
  });

  it("returns null when a series is constant", () => {
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
});
