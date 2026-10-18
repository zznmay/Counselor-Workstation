import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

import { firstAccessiblePath, getStoredUser } from '@/lib/auth';

/** 403：当前角色未被分配该模块权限 */
export default function Forbidden() {
  const navigate = useNavigate();
  const user = getStoredUser();
  return (
    <div className="page" style={{ paddingTop: 32 }}>
      <Result
        status="403"
        title="无权访问该模块"
        subTitle="当前角色未被分配该模块的访问权限。如需使用，请联系管理员在「角色管理」中调整。"
        extra={
          <Button type="primary" onClick={() => navigate(firstAccessiblePath(user), { replace: true })}>
            返回可访问页面
          </Button>
        }
      />
    </div>
  );
}
