import { createElement } from 'react';
import {
  Briefcase,
  Building2,
  Car,
  CircleMinus,
  Box,
  CreditCard,
  FileText,
  Flag,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Leaf,
  Lock,
  PieChart,
  Sun,
  TrendingUp,
  Umbrella,
  Wallet,
  Banknote,
  type LucideIcon,
} from 'lucide-react';

/** The shared catalogue names icons with Ionicons keys (mobile); the web maps them to lucide icons. */
const MAP: Record<string, LucideIcon> = {
  'card-outline': CreditCard,
  'wallet-outline': Wallet,
  'cash-outline': Banknote,
  'trending-up-outline': TrendingUp,
  'briefcase-outline': Briefcase,
  'umbrella-outline': Umbrella,
  'medkit-outline': HeartPulse,
  'business-outline': Building2,
  'leaf-outline': Leaf,
  'lock-closed-outline': Lock,
  'pie-chart-outline': PieChart,
  'home-outline': Home,
  'cube-outline': Box,
  'car-outline': Car,
  'school-outline': GraduationCap,
  'document-text-outline': FileText,
  'remove-circle-outline': CircleMinus,
  'sunny-outline': Sun,
  'flag-outline': Flag,
  'landmark-outline': Landmark,
};

export function iconFor(key: string | undefined): LucideIcon {
  return (key && MAP[key]) || Box;
}

export function CatalogIcon({ name, className }: { name: string | undefined; className?: string }) {
  return createElement(iconFor(name), { className, 'aria-hidden': true });
}
