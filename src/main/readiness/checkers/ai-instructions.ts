import type { ProviderId } from '../../../shared/types';
import type { AnalysisContext, ReadinessCheckProducer, TaggedCheck } from '../types';
import { type InstructionFileOpts, runAllInstructionChecks } from './instruction-file-checks';

export function makeInstructionProducer(providerId: ProviderId, opts: InstructionFileOpts): ReadinessCheckProducer {
  return {
    providerId,
    produce(projectPath: string, _ctx: AnalysisContext): TaggedCheck[] {
      return runAllInstructionChecks(projectPath, opts).map(check => ({
        category: 'instructions',
        check,
      }));
    },
  };
}

export const claudeInstructionFileOpts: InstructionFileOpts = {
  fileName: 'CLAUDE.md',
  fallbackDirectory: '.claude',
  idPrefix: 'claude-md',
  displayName: 'CLAUDE.md',
};

export const aiInstructionsProducer = makeInstructionProducer('claude', claudeInstructionFileOpts);
