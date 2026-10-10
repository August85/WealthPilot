import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { useTheme } from '@/theme/ThemeProvider';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: 'Overview', icon: 'pie-chart-outline', iconActive: 'pie-chart' },
  { name: 'accounts', title: 'Accounts', icon: 'wallet-outline', iconActive: 'wallet' },
  { name: 'plan', title: 'Plan', icon: 'map-outline', iconActive: 'map' },
  { name: 'insights', title: 'Insights', icon: 'bulb-outline', iconActive: 'bulb' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.textMuted,
        tabBarStyle: { backgroundColor: t.colors.tabBar, borderTopColor: t.colors.border },
        headerStyle: { backgroundColor: t.colors.surface },
        headerTintColor: t.colors.text,
        sceneStyle: { backgroundColor: t.colors.background },
        tabBarLabelStyle: { fontSize: 12 },
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            headerTitle: tab.name === 'index' ? 'WealthPilot' : tab.title,
            tabBarAccessibilityLabel: `${tab.title} tab`,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
