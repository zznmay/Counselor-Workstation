import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { diffCounselorIds } from '../server/lib/studentDiff.js';

/**
 * 班级导入 upsert 辅导员集合比对单测：
 * 班级已存在时唯一可变字段是辅导员分配（classCounselors），
 * 覆盖「新增分配、移除分配、无差异（跳过）」三类场景。
 */
describe('diffCounselorIds（班级导入辅导员集合比对）', () => {
  it('无差异场景：现有集合与导入集合一致 → toAdd/toRemove 均为空，导入时跳过', () => {
    const { toAdd, toRemove } = diffCounselorIds([3, 7, 9], [3, 7, 9]);
    assert.deepStrictEqual(toAdd, []);
    assert.deepStrictEqual(toRemove, []);
  });

  it('新增分配场景：导入比现有多出 2 名辅导员 → 仅 toAdd', () => {
    const { toAdd, toRemove } = diffCounselorIds([3], [3, 7, 9]);
    assert.deepStrictEqual(toAdd, [7, 9]);
    assert.deepStrictEqual(toRemove, []);
  });

  it('移除分配场景：导入比现有少 1 名辅导员 → 仅 toRemove', () => {
    const { toAdd, toRemove } = diffCounselorIds([3, 7, 9], [7]);
    assert.deepStrictEqual(toAdd, []);
    assert.deepStrictEqual(toRemove, [3, 9]);
  });

  it('混合场景：既有新增又有移除 → 差集双向返回', () => {
    const { toAdd, toRemove } = diffCounselorIds([3, 7], [7, 9, 11]);
    assert.deepStrictEqual(toAdd, [9, 11]);
    assert.deepStrictEqual(toRemove, [3]);
  });

  it('边界口径：空辅导员列导入视为清空全部分配；空集合比对安全', () => {
    assert.deepStrictEqual(diffCounselorIds([3, 7], []), { toAdd: [], toRemove: [3, 7] });
    assert.deepStrictEqual(diffCounselorIds([], [3]), { toAdd: [3], toRemove: [] });
    assert.deepStrictEqual(diffCounselorIds([], []), { toAdd: [], toRemove: [] });
    assert.deepStrictEqual(diffCounselorIds(undefined, undefined), { toAdd: [], toRemove: [] });
  });

  it('幂等口径：重复导入同一分配 → 无差异（跳过）', () => {
    const first = diffCounselorIds([], [3, 7]);
    assert.deepStrictEqual(first, { toAdd: [3, 7], toRemove: [] });
    // 入库后再导入同一行：现有=[3,7]，导入=[3,7]
    const again = diffCounselorIds([3, 7], [3, 7]);
    assert.deepStrictEqual(again, { toAdd: [], toRemove: [] });
  });
});
