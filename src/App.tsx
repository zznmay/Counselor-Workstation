import { RouterProvider } from 'react-router-dom';

import RouteFallback from '@/components/RouteFallback';
import { router } from '@/router';

export default function App() {
  return <RouterProvider router={router} fallbackElement={<RouteFallback full />} />;
}
