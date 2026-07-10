import type { Component } from 'vue'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Boxes,
  CheckCircle,
  CircleDollarSign,
  Clock,
  FileText,
  KeyRound,
  MessageSquare,
  Package,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Truck,
  XCircle
} from '@lucide/vue'

export const iconRegistry = {
  activity: Activity,
  ads: CircleDollarSign,
  agent: Bot,
  analytics: BarChart3,
  authorization: KeyRound,
  chat: MessageSquare,
  compliance: ShieldCheck,
  error: XCircle,
  inventory: Boxes,
  listing: FileText,
  logistics: Truck,
  plugin: Plug,
  product: Package,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  store: Store,
  success: CheckCircle,
  time: Clock,
  warning: AlertTriangle
} satisfies Record<string, Component>

export type YjIconName = keyof typeof iconRegistry
