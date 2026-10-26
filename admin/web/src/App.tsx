import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute, RoleGate } from './components/ProtectedRoute';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { menuItems } from './menu';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AdminLayout />}>
          {menuItems.map((item) =>
            item.path === '/' ? (
              <Route
                key="index"
                index
                element={<RoleGate roles={item.roles}>{item.element}</RoleGate>}
              />
            ) : (
              <Route
                key={item.path}
                path={item.path}
                element={<RoleGate roles={item.roles}>{item.element}</RoleGate>}
              />
            ),
          )}
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
