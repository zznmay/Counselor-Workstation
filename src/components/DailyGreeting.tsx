import { Button, Modal } from 'antd';
import dayjs from 'dayjs';

/**
 * 每日问候弹窗：昵称（或真实姓名）+ 随机鼓励语。
 * 每天首次打开页面时弹出一次，同一天内不再弹出。
 */
export default function DailyGreeting({
  open,
  name,
  encouragement,
  emoji,
  onClose,
  onEdit,
}: {
  open: boolean;
  name: string;
  encouragement: string;
  emoji: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={380}
      footer={[
        <Button key="edit" type="link" onClick={onEdit}>
          修改称呼
        </Button>,
        <Button key="go" type="primary" onClick={onClose}>
          开启今天的工作
        </Button>,
      ]}
    >
      <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
        <div className="greet-emoji">{emoji}</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 16 }}>Hi，{name}！</div>
        <div style={{ color: 'rgba(0,0,0,0.65)', marginTop: 10, lineHeight: 1.7 }}>
          {encouragement}
        </div>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 12, marginTop: 12 }}>
          {dayjs().format('YYYY年MM月DD日 dddd')}
        </div>
      </div>
    </Modal>
  );
}
