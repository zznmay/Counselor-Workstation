import { Checkbox, Select } from 'antd';
import { useMemo } from 'react';

import type { ClassOption } from '@/types';

interface ClassMultiSelectProps {
  classOptions: ClassOption[];
  /** 由 Form.Item 注入 */
  value?: number[];
  onChange?: (value: number[]) => void;
  placeholder?: string;
}

/**
 * 所辖班级多选：按年级分组，支持年级全选/取消全选与全院全选。
 * 单个班级仍走 Select 原生勾选；批量操作直接回写 Form 的 classIds。
 */
export default function ClassMultiSelect({
  classOptions,
  value = [],
  onChange,
  placeholder = '选择所辖班级（可多选）',
}: ClassMultiSelectProps) {
  const groups = useMemo(() => {
    const list: { gradeName: string; items: ClassOption[] }[] = [];
    const index = new Map<string, number>();
    for (const opt of classOptions) {
      let gi = index.get(opt.gradeName);
      if (gi === undefined) {
        gi = list.length;
        index.set(opt.gradeName, gi);
        list.push({ gradeName: opt.gradeName, items: [] });
      }
      list[gi].items.push(opt);
    }
    return list;
  }, [classOptions]);

  const allIds = useMemo(() => groups.flatMap((g) => g.items.map((c) => c.id)), [groups]);
  const selectedIds = useMemo(() => new Set(value), [value]);
  const selectedCount = allIds.filter((id) => selectedIds.has(id)).length;
  const allChecked = allIds.length > 0 && selectedCount === allIds.length;
  const allIndeterminate = selectedCount > 0 && !allChecked;

  const emit = (ids: number[]) => onChange?.(ids);

  const toggleAll = () => {
    emit(allChecked ? [] : [...new Set([...value, ...allIds])]);
  };

  const toggleGroup = (items: ClassOption[], checked: boolean) => {
    const ids = items.map((c) => c.id);
    if (checked) {
      emit(value.filter((id) => !ids.includes(id)));
    } else {
      emit([...new Set([...value, ...ids])]);
    }
  };

  return (
    <div className="class-multi-select">
      <Select
        mode="multiple"
        allowClear
        showSearch
        optionFilterProp="children"
        placeholder={placeholder}
        value={value}
        onChange={(ids: number[]) => emit(ids)}
        dropdownRender={(menu) => (
          <>
            <div className="class-bulk-bar">
              <Checkbox
                checked={allChecked}
                indeterminate={allIndeterminate}
                disabled={allIds.length === 0}
                onChange={toggleAll}
              >
                全院全选
              </Checkbox>
              <span className="class-bulk-count">
                已选 {selectedCount} / {allIds.length} 个班级
              </span>
            </div>
            <div className="class-bulk-divider" />
            {menu}
          </>
        )}
      >
        {groups.map((g) => {
          const groupSelected = g.items.filter((c) => selectedIds.has(c.id)).length;
          const groupChecked = g.items.length > 0 && groupSelected === g.items.length;
          return (
            <Select.OptGroup
              key={g.gradeName}
              label={(
                <span className="class-group-head">
                  <Checkbox
                    checked={groupChecked}
                    indeterminate={groupSelected > 0 && !groupChecked}
                    onChange={() => toggleGroup(g.items, groupChecked)}
                  >
                    {g.gradeName}
                  </Checkbox>
                  <span className="class-group-hint">{groupChecked ? '取消全选' : '全选'}</span>
                  <span className="class-group-count">{groupSelected}/{g.items.length}</span>
                </span>
              )}
            >
              {g.items.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select.OptGroup>
          );
        })}
      </Select>
      <div className="class-select-total">
        已选 <b>{selectedCount}</b> 个班级（共 {allIds.length} 个）
      </div>
    </div>
  );
}
