import type { ToolIconKind } from '../../utils/toolStepMetadata';
import {
  ThinkIcon,
  ReadFileIcon,
  TerminalCommandIcon,
  CodeEditIcon,
  CodeSearchIcon,
  GlobeWebIcon,
  PlanIcon,
  LogIcon,
} from './AnimatedToolIcons';
import {
  ChatHistoryIcon,
  FetchPageIcon,
  FolderListIcon,
  DocCreateIcon,
  DeleteFileIcon,
  MemoryGraphIcon,
  ImageGenIcon,
  SubAgentIcon,
  CloudDeployIcon,
  ToolboxIcon,
  CompactIcon,
} from './ExtendedToolIcons';

interface ToolStepIconProps {
  iconKind: ToolIconKind;
  status?: 'running' | 'success' | 'failed' | 'pending' | string;
  className?: string;
}

export function ToolStepIcon({ iconKind, status = 'running', className = 'w-4 h-4' }: ToolStepIconProps) {
  switch (iconKind) {
    case 'think':
      return <ThinkIcon status={status} className={className} />;
    case 'log':
      return <LogIcon status={status} className={className} />;
    case 'compact':
      return <CompactIcon status={status} className={className} />;
    case 'chatHistory':
      return <ChatHistoryIcon status={status} className={className} />;
    case 'fetchPage':
      return <FetchPageIcon status={status} className={className} />;
    case 'webSearch':
      return <GlobeWebIcon status={status} className={className} />;
    case 'readFile':
      return <ReadFileIcon status={status} className={className} />;
    case 'listDir':
      return <FolderListIcon status={status} className={className} />;
    case 'codeEdit':
      return <CodeEditIcon status={status} className={className} />;
    case 'createDoc':
      return <DocCreateIcon status={status} className={className} />;
    case 'deleteFile':
      return <DeleteFileIcon status={status} className={className} />;
    case 'codeSearch':
      return <CodeSearchIcon status={status} className={className} />;
    case 'terminal':
      return <TerminalCommandIcon status={status} className={className} />;
    case 'plan':
      return <PlanIcon status={status} className={className} />;
    case 'memoryGraph':
      return <MemoryGraphIcon status={status} className={className} />;
    case 'imageGen':
      return <ImageGenIcon status={status} className={className} />;
    case 'subAgent':
      return <SubAgentIcon status={status} className={className} />;
    case 'cloudDeploy':
      return <CloudDeployIcon status={status} className={className} />;
    case 'toolbox':
    default:
      return <ToolboxIcon status={status} className={className} />;
  }
}
