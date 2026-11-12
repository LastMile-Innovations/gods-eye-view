import {
  createElement,
  Globe,
  FolderKanban,
  Columns3,
  FileText,
  ShieldCheck,
  Store,
  MessagesSquare,
  Bot,
  Plus,
  Minus,
  Navigation,
  SlidersHorizontal,
  Eye,
  Activity,
  PanelsTopLeft,
  History,
  Database,
  Search,
  Grid2x2,
} from 'lucide';
const icons = {
  records: Database,
  projects: FolderKanban,
  board: Columns3,
  documents: FileText,
  evidence: ShieldCheck,
  marketplace: Store,
  social: MessagesSquare,
  agent: Bot,
  recovery: Activity,
  desks: PanelsTopLeft,
  history: History,
  world: Globe,
  search: Search,
  apps: Grid2x2,
  zoomIn: Plus,
  zoomOut: Minus,
  north: Navigation,
  settings: SlidersHorizontal,
  view: Eye,
};
export function appIcon(id) {
  const svg = createElement(icons[id] || Database);
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('nd-icon');
  return svg;
}
