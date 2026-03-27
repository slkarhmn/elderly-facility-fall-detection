import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FBF7EC',
          borderTopColor: 'rgba(49,55,43,0.08)',
          borderTopWidth: 1,
          height: 72,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: '#31372B',
        tabBarInactiveTintColor: 'rgba(49,55,43,0.3)',
        tabBarLabelStyle: {
          fontFamily: 'NunitoSans_800ExtraBold',
          fontSize: 9,
          letterSpacing: 1,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  )
}