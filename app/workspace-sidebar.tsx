'use client';
/* oxlint-disable next/no-img-element -- Navigation uses the original bundled Figma assets. */
import {
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { FilePlus2, FolderPlus, Layers2, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useI18n } from './i18n';
import { RecentBoards } from './recent-boards';
import { WorkspaceSidebarLabel } from './workspace-sidebar-label';
import { partitionPinnedBoards } from './workspace-store';
import { WorkspaceMenu } from './workspace-menu';
import { MaterialIcon } from './material-icon';
import { useDesktopPlatform } from './desktop-bridge';
import './workspace-sidebar.css';

export type WorkspaceSidebarView =
  | 'canvas'
  | 'boards'
  | 'library'
  | 'atlas'
  | 'databases';
export type WorkspaceSidebarProps = {
  boards: { id: string; title: string; pinnedAt?: number }[];
  currentId: string | null;
  activeView: WorkspaceSidebarView;
  onBoards: () => void;
  onLibrary: () => void;
  onNewBoard: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onRecycle: () => void;
  onMemoryAtlas: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDatabases: () => void;
  databasePanel: ReactNode;
  homePanel?: ReactNode;
  allFilesActive?: boolean;
  onNewNotePage?: () => void;
  onNewFolder?: () => void;
  onImportFiles?: () => void;
  searchLabel?: string;
};

function SidebarTip({
  label,
  children,
  side = 'right',
}: {
  label: string;
  children: ReactElement;
  side?: 'right' | 'bottom';
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="lumior-tooltip" side={side} sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceSidebar({
  boards,
  currentId,
  activeView,
  onBoards,
  onLibrary,
  onNewBoard,
  onSearch,
  onSettings,
  onRecycle,
  onMemoryAtlas,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onPin,
  onDatabases,
  databasePanel,
  homePanel,
  allFilesActive = false,
  onNewNotePage,
  onNewFolder,
  onImportFiles,
  searchLabel,
}: WorkspaceSidebarProps) {
  const { t } = useI18n();
  const platform = useDesktopPlatform();
  const searchShortcut =
    platform === 'win32' || platform === 'linux' ? 'Ctrl+K' : '⌘K';
  const { open, openMobile, setOpenMobile, isMobile } = useSidebar();
  const panelId = useId();
  const drawer = useRef<HTMLDivElement>(null);
  const homeButton = useRef<HTMLButtonElement>(null);
  const homeActive = activeView === 'canvas' || activeView === 'boards';
  const databaseActive = activeView === 'databases';
  const panelActive = homeActive || databaseActive;
  const desktopExpanded = panelActive && !isMobile && open;
  const { pinned, recent } = partitionPinnedBoards(boards);
  const hasFilePanel = homePanel !== undefined;
  const contentSearchLabel =
    searchLabel ||
    (hasFilePanel
      ? t('Search all content', '搜索所有内容')
      : t('Search all cards', '搜索所有卡片'));
  const hasCreationMenu =
    hasFilePanel || !!(onNewNotePage || onNewFolder || onImportFiles);
  useEffect(() => {
    if ((!isMobile || !panelActive) && openMobile) setOpenMobile(false);
  }, [isMobile, panelActive, openMobile, setOpenMobile]);
  useEffect(() => {
    if (!desktopExpanded && drawer.current?.contains(document.activeElement))
      homeButton.current?.focus();
  }, [desktopExpanded]);
  const act = (action: () => void) => {
    setOpenMobile(false);
    action();
  };
  const actions = {
    onOpen: (id: string) => act(() => onOpen(id)),
    onRename,
    onDuplicate,
    onDelete,
    onPin,
  };
  const list = (
    <section
      className="workspace-board-panel"
      aria-label={t('Home sidebar', 'Home 侧边栏')}
    >
      <div className="workspace-board-actions">
        <SidebarTip
          side="bottom"
          label={contentSearchLabel + ' · ' + searchShortcut}
        >
          <button
            type="button"
            className="workspace-board-search"
            aria-label={contentSearchLabel}
            onClick={() => act(onSearch)}
          >
            <span>{contentSearchLabel}</span>
            <kbd aria-hidden="true">
              {platform === 'win32' || platform === 'linux' ? (
                'Ctrl'
              ) : (
                <img
                  src="/assets/workspace-shell/search-command.svg"
                  width="14"
                  height="14"
                  alt=""
                  draggable={false}
                />
              )}
              <span>K</span>
            </kbd>
          </button>
        </SidebarTip>
        {hasCreationMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="workspace-board-icon-button"
              aria-label={t('Create new', '新建')}
              title={t('Create new', '新建')}
            >
              <img
                src="/assets/workspace-shell/new-board.svg"
                width="16"
                height="16"
                alt=""
                draggable={false}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="lumior-menu workspace-create-menu"
              align="end"
            >
              <DropdownMenuItem onClick={() => act(onNewBoard)}>
                <Layers2 size={16} aria-hidden="true" />
                {t('New whiteboard', '新建画板')}
              </DropdownMenuItem>
              {onNewNotePage && (
                <DropdownMenuItem onClick={() => act(onNewNotePage)}>
                  <FilePlus2 size={16} aria-hidden="true" />
                  {t('New NotePage', '新建 NotePage')}
                </DropdownMenuItem>
              )}
              {onNewFolder && (
                <DropdownMenuItem onClick={() => act(onNewFolder)}>
                  <FolderPlus size={16} aria-hidden="true" />
                  {t('New folder', '新建文件夹')}
                </DropdownMenuItem>
              )}
              {onImportFiles && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => act(onImportFiles)}>
                    <Upload size={16} aria-hidden="true" />
                    {t('Import files', '导入文件')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <SidebarTip side="bottom" label={t('New whiteboard', '新建画板')}>
            <button
              type="button"
              className="workspace-board-icon-button"
              aria-label={t('New whiteboard', '新建画板')}
              onClick={() => act(onNewBoard)}
            >
              <img
                src="/assets/workspace-shell/new-board.svg"
                width="16"
                height="16"
                alt=""
                draggable={false}
              />
            </button>
          </SidebarTip>
        )}
      </div>
      {hasFilePanel && (
        <button
          type="button"
          className="workspace-my-library"
          aria-current={allFilesActive ? 'page' : undefined}
          onClick={() => act(onBoards)}
        >
          <span className="workspace-my-library-icon" aria-hidden="true" />
          <WorkspaceSidebarLabel>{t('Home', '首页')}</WorkspaceSidebarLabel>
        </button>
      )}
      <div className="workspace-board-scroll">
        {hasFilePanel ? (
          homePanel
        ) : (
          <>
            {pinned.length > 0 && (
              <section
                className="workspace-board-section workspace-board-pinned"
                aria-labelledby={panelId + '-pin'}
              >
                <h2
                  id={panelId + '-pin'}
                  className="workspace-board-list-label"
                >
                  {t('Pinned', '置顶')}
                </h2>
                <RecentBoards
                  boards={pinned}
                  activeId={activeView === 'canvas' ? currentId : null}
                  label={t('Pinned whiteboards', '置顶画板')}
                  {...actions}
                />
              </section>
            )}
            <section
              className="workspace-board-section workspace-board-recent"
              aria-labelledby={panelId + '-recent'}
            >
              <h2
                id={panelId + '-recent'}
                className="workspace-board-list-label"
              >
                {t('Recents', '最近使用')}
              </h2>
              <RecentBoards
                boards={recent}
                activeId={activeView === 'canvas' ? currentId : null}
                {...actions}
              />
            </section>
            {!boards.length && (
              <p className="workspace-board-empty">
                {t(
                  'Create your first whiteboard to get started.',
                  '创建第一张画板，开始整理你的想法。',
                )}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );

  return (
    <aside
      className="workspace-sidebar"
      aria-label={t('Workspace sidebar', '工作区侧边栏')}
      data-expanded={desktopExpanded}
      data-mobile={isMobile}
      data-home={panelActive}
    >
      <svg
        className="workspace-icon-filters"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            id="workspace-shell-hover-ink"
            colorInterpolationFilters="sRGB"
          >
            <feComponentTransfer>
              <feFuncA type="linear" slope="1.3333333333333333" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <div className="workspace-rail">
        <nav
          className="workspace-rail-navigation"
          aria-label={t('Workspace navigation', '工作区导航')}
        >
          <SidebarTip label={t('Home', '首页')}>
            <button
              ref={homeButton}
              type="button"
              className="workspace-rail-destination"
              aria-label={t('Home', '首页')}
              aria-pressed={homeActive}
              onClick={() => act(onBoards)}
            >
              <img
                className="workspace-rail-icon"
                src={
                  '/assets/workspace-shell/home-' +
                  (homeActive ? 'filled' : 'outline') +
                  '.svg'
                }
                width="24"
                height="24"
                alt=""
                draggable={false}
              />
            </button>
          </SidebarTip>
          <SidebarTip label={t('Card Library', '卡片库')}>
            <button
              type="button"
              className="workspace-rail-destination"
              aria-label={t('Card Library', '卡片库')}
              aria-pressed={activeView === 'library'}
              onClick={() => act(onLibrary)}
            >
              <img
                className="workspace-rail-icon"
                src={
                  '/assets/workspace-shell/library-' +
                  (activeView === 'library' ? 'filled' : 'outline') +
                  '.svg'
                }
                width="24"
                height="24"
                alt=""
                draggable={false}
              />
            </button>
          </SidebarTip>
          <SidebarTip label={t('Databases', '多维表')}>
            <button
              type="button"
              className="workspace-rail-destination"
              aria-label={t('Databases', '多维表')}
              aria-pressed={databaseActive}
              onClick={onDatabases}
            >
              <img
                className="workspace-rail-icon"
                src={
                  '/assets/workspace-shell/table-' +
                  (databaseActive ? 'filled' : 'outline') +
                  '.svg'
                }
                width="24"
                height="24"
                alt=""
                draggable={false}
              />
            </button>
          </SidebarTip>
          <SidebarTip label={t('Star Sea', '星海')}>
            <button type="button" className="workspace-rail-destination"
              aria-label={t('Star Sea', '星海')} aria-pressed={activeView === 'atlas'}
              onClick={() => act(onMemoryAtlas)}>
              <MaterialIcon name="hub" size={20} filled={activeView === 'atlas'} />
            </button>
          </SidebarTip>
        </nav>
        <div className="workspace-rail-bottom">
          <WorkspaceMenu
            onSettings={() => act(onSettings)}
            onRecycle={() => act(onRecycle)}
          />
        </div>
      </div>
      {!isMobile && panelActive && (
        <div
          ref={drawer}
          id={panelId}
          className="workspace-board-drawer"
          inert={!desktopExpanded}
          aria-hidden={!desktopExpanded}
        >
          {databaseActive ? databasePanel : list}
        </div>
      )}
      {isMobile && panelActive && (
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            id={panelId}
            side="left"
            showCloseButton={false}
            className="workspace-board-sheet"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>
                {databaseActive
                  ? t('Databases', '多维表')
                  : t('Home sidebar', 'Home 侧边栏')}
              </SheetTitle>
              <SheetDescription>
                {databaseActive
                  ? t('Create and open databases.', '创建和打开多维表。')
                  : hasFilePanel
                    ? t(
                        'Browse folders, pinned files and recently opened content.',
                        '浏览文件夹、置顶文件和最近打开的内容。',
                      )
                    : t(
                        'Search your cards, and create, pin or open whiteboards.',
                        '搜索卡片，新建、置顶和打开画板。',
                      )}
              </SheetDescription>
            </SheetHeader>
            {databaseActive ? databasePanel : list}
          </SheetContent>
        </Sheet>
      )}
    </aside>
  );
}
