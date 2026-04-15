import React from 'react';
import { Layout as AntLayout, Menu } from 'antd';
import {
  RobotOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { MenuProps } from 'antd';

const { Sider, Content } = AntLayout;

const MENU_ITEMS: MenuProps['items'] = [
  {
    key: '/agents',
    icon: <RobotOutlined />,
    label: '智能体管理',
  },
  {
    key: '/eval',
    icon: <SafetyCertificateOutlined />,
    label: '安全评估',
    children: [
      { key: '/eval', label: '评估任务列表' },
      { key: '/eval/new', label: '新建评估' },
    ],
  },
  {
    key: '/reports',
    icon: <FileTextOutlined />,
    label: '评估报告',
  },
];

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = React.useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/reports')) return '/reports';
    if (path.startsWith('/eval/new')) return '/eval/new';
    if (path.startsWith('/eval')) return '/eval';
    if (path.startsWith('/agents')) return '/agents';
    return '/agents';
  }, [location.pathname]);

  const openKey = React.useMemo(() => {
    if (location.pathname.startsWith('/eval')) return ['/eval'];
    return [];
  }, [location.pathname]);

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
  };

  return (
    <AntLayout className="app-layout">
      <Sider
        className="app-sider"
        width={240}
        theme="dark"
      >
        <div className="logo-container">
          <SafetyOutlined style={{ color: '#1677ff', fontSize: 22, marginRight: 8 }} />
          <h2>智能体安全测评平台</h2>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKey}
          items={MENU_ITEMS}
          onClick={handleMenuClick}
          style={{ marginTop: 8 }}
        />
      </Sider>
      <AntLayout style={{ marginLeft: 240 }}>
        <Content className="app-content">
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
};

export default AppLayout;
