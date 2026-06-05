import { ArrowUpRight, Bug, Chats as MessagesSquare, Check, Copy, GitPullRequest, Lightbulb, Megaphone, Newspaper } from '@phosphor-icons/react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  REFACTORING_HOME_URL,
  TOLARIA_GITHUB_CONTRIBUTING_URL,
  TOLARIA_GITHUB_DISCUSSIONS_URL,
  TOLARIA_GITHUB_ISSUES_URL,
  TOLARIA_GITHUB_PULL_REQUESTS_URL,
  TOLARIA_PRODUCT_BOARD_URL,
} from '../constants/feedback'
import {
  buildSanitizedDiagnosticBundle,
  startFeedbackDiagnosticsCapture,
} from '../lib/feedbackDiagnostics'
import { cn } from '../lib/utils'
import { takeFeedbackDialogOpener } from '../lib/feedbackDialogOpener'
import { useBuildNumber } from '../hooks/useBuildNumber'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { createTranslator, type AppLocale, type TranslationKey } from '../lib/i18n'
import { openExternalUrl } from '../utils/url'

interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
  buildNumber?: string
  locale?: AppLocale
  releaseChannel?: string | null
}

interface ContributionCardProps {
  title: string
  description: string
  ctaLabel: string
  icon: typeof Lightbulb
  tone: ContributionTone
  onAction: () => void
  autoFocus?: boolean
  secondaryAction?: ReactNode
}

interface LinkFallback {
  label: string
  url: string
}

interface ContributionPath {
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  ctaLabelKey: TranslationKey
  labelKey: TranslationKey
  url: string
  icon: typeof Lightbulb
  tone: ContributionTone
  secondaryLink?: ContributionLink
}

interface ContributionLink {
  ctaLabelKey: TranslationKey
  labelKey: TranslationKey
  url: string
}

const EMPTY_DIALOG_OPENER: ReturnType<typeof takeFeedbackDialogOpener> = {
  element: null,
  reopenCommandPalette: false,
}

type ContributionTone = 'blue' | 'green' | 'yellow' | 'purple' | 'red'

const CONTRIBUTION_TONE_CLASSES: Record<ContributionTone, string> = {
  blue: 'bg-[var(--accent-blue-light)] text-[var(--accent-blue)]',
  green: 'bg-[var(--accent-green-light)] text-[var(--accent-green)]',
  yellow: 'bg-[var(--accent-yellow-light)] text-[var(--accent-yellow)]',
  purple: 'bg-[var(--accent-purple-light)] text-[var(--accent-purple)]',
  red: 'bg-[var(--accent-red-light)] text-[var(--accent-red)]',
}

const CONTRIBUTION_BUTTON_CLASSES: Record<ContributionTone, string> = {
  blue: 'border-[var(--accent-blue)] hover:bg-[var(--accent-blue-light)] [&_svg]:text-[var(--accent-blue)]',
  green: 'border-[var(--accent-green)] hover:bg-[var(--accent-green-light)] [&_svg]:text-[var(--accent-green)]',
  yellow: 'border-[var(--accent-yellow)] hover:bg-[var(--accent-yellow-light)] [&_svg]:text-[var(--accent-yellow)]',
  purple: 'border-[var(--accent-purple)] hover:bg-[var(--accent-purple-light)] [&_svg]:text-[var(--accent-purple)]',
  red: 'border-[var(--accent-red)] hover:bg-[var(--accent-red-light)] [&_svg]:text-[var(--accent-red)]',
}

const SPONSOR_SUPPORT_PATH = {
  titleKey: 'feedback.sponsor.title',
  descriptionKey: 'feedback.sponsor.description',
  ctaLabelKey: 'feedback.sponsor.cta',
  labelKey: 'feedback.sponsor.linkLabel',
  url: REFACTORING_HOME_URL,
  icon: Newspaper,
  tone: 'blue',
} satisfies ContributionPath

const CONTRIBUTION_PATHS: ContributionPath[] = [
  {
    titleKey: 'feedback.featureRequests.title',
    descriptionKey: 'feedback.featureRequests.description',
    ctaLabelKey: 'feedback.featureRequests.cta',
    labelKey: 'feedback.featureRequests.linkLabel',
    url: TOLARIA_PRODUCT_BOARD_URL,
    icon: Lightbulb,
    tone: 'green',
  },
  {
    titleKey: 'feedback.discussions.title',
    descriptionKey: 'feedback.discussions.description',
    ctaLabelKey: 'feedback.discussions.cta',
    labelKey: 'feedback.discussions.linkLabel',
    url: TOLARIA_GITHUB_DISCUSSIONS_URL,
    icon: MessagesSquare,
    tone: 'purple',
  },
  {
    titleKey: 'feedback.contributeCode.title',
    descriptionKey: 'feedback.contributeCode.description',
    ctaLabelKey: 'feedback.contributeCode.cta',
    labelKey: 'feedback.contributeCode.linkLabel',
    url: TOLARIA_GITHUB_PULL_REQUESTS_URL,
    icon: GitPullRequest,
    tone: 'yellow',
    secondaryLink: {
      ctaLabelKey: 'feedback.contributingGuide.cta',
      labelKey: 'feedback.contributingGuide.linkLabel',
      url: TOLARIA_GITHUB_CONTRIBUTING_URL,
    },
  },
]

function ContributionLinkButton({
  label,
  tone,
  onAction,
  autoFocus = false,
  accented = true,
}: {
  label: string
  tone: ContributionTone
  onAction: () => void
  autoFocus?: boolean
  accented?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'w-full justify-between',
        accented && 'bg-background text-foreground hover:text-foreground',
        accented && Reflect.get(CONTRIBUTION_BUTTON_CLASSES, tone),
      )}
      autoFocus={autoFocus}
      onClick={onAction}
    >
      {label}
      <ArrowUpRight size={14} />
    </Button>
  )
}

function ContributionCard({
  title,
  description,
  ctaLabel,
  icon: Icon,
  tone,
  onAction,
  autoFocus = false,
  secondaryAction,
}: ContributionCardProps) {
  return (
    <Card className="gap-4 border-border/70 py-4 shadow-none">
      <CardHeader className="gap-3 px-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={cn('rounded-md p-2', Reflect.get(CONTRIBUTION_TONE_CLASSES, tone))}>
            <Icon size={16} />
          </span>
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
        <CardDescription className="whitespace-pre-line text-sm leading-6 text-muted-foreground">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <ContributionLinkButton label={ctaLabel} tone={tone} autoFocus={autoFocus} onAction={onAction} />
      </CardContent>
      {secondaryAction ? <CardFooter className="px-4 pt-0">{secondaryAction}</CardFooter> : null}
    </Card>
  )
}

type Translate = ReturnType<typeof createTranslator>

function LinkFallbackBanner({ linkFallback, t }: { linkFallback: LinkFallback | null; t: Translate }) {
  if (!linkFallback) return null

  return (
    <div
      className="rounded-lg border px-4 py-3 text-sm"
      style={{
        background: 'var(--feedback-warning-bg)',
        borderColor: 'var(--feedback-warning-border)',
        color: 'var(--feedback-warning-text)',
      }}
    >
      <p className="font-medium">{t('feedback.linkFallback.title', { label: linkFallback.label })}</p>
      <p className="mt-1">{t('feedback.linkFallback.description')}</p>
      <p className="mt-2 break-all rounded-md bg-popover px-3 py-2 font-mono text-xs text-foreground">
        {linkFallback.url}
      </p>
    </div>
  )
}

function getCopyDiagnosticsLabel(copyState: 'idle' | 'copied' | 'failed', t: Translate) {
  return copyState === 'copied' ? t('feedback.diagnosticsCopied') : t('feedback.copyDiagnostics')
}

function BugReportActions({
  copyState,
  canCopyDiagnostics,
  onCopyDiagnostics,
  t,
}: {
  copyState: 'idle' | 'copied' | 'failed'
  canCopyDiagnostics: boolean
  onCopyDiagnostics: () => void
  t: Translate
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between"
        onClick={onCopyDiagnostics}
        disabled={!canCopyDiagnostics}
      >
        {getCopyDiagnosticsLabel(copyState, t)}
        {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      </Button>
      {copyState === 'copied' ? (
        <p className="text-xs font-medium text-foreground">{t('feedback.diagnosticsCopiedSentence')}</p>
      ) : null}
      {copyState === 'failed' ? (
        <p className="text-xs font-medium text-[var(--feedback-warning-text)]">
          {t('feedback.clipboardUnavailable')}
        </p>
      ) : null}
    </div>
  )
}

function useDialogReturnFocus(open: boolean, onClose: () => void) {
  const openerRef = useRef(EMPTY_DIALOG_OPENER)

  useLayoutEffect(() => {
    if (open) {
      openerRef.current = takeFeedbackDialogOpener()
    }
  }, [open])

  return () => {
    const { element: opener, reopenCommandPalette } = openerRef.current
    openerRef.current = takeFeedbackDialogOpener()

    onClose()
    window.setTimeout(() => {
      if (reopenCommandPalette) {
        window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, {
          detail: APP_COMMAND_IDS.viewCommandPalette,
        }))
        return
      }

      if (opener?.isConnected) {
        opener.focus()
      }
    }, 80)
  }
}

function useFeedbackDialogActions(diagnosticsBundle: string) {
  const [linkFallback, setLinkFallback] = useState<LinkFallback | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const canCopyDiagnostics = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'

  const handleOpenLink = (label: string, url: string) => {
    void openExternalUrl(url)
      .then(() => {
        setLinkFallback(null)
      })
      .catch(() => {
        setLinkFallback({ label, url })
      })
  }

  const handleCopyDiagnostics = () => {
    if (!canCopyDiagnostics) {
      setCopyState('failed')
      return
    }

    void navigator.clipboard.writeText(diagnosticsBundle)
      .then(() => {
        setCopyState('copied')
      })
      .catch(() => {
        setCopyState('failed')
      })
  }

  const reset = () => {
    setLinkFallback(null)
    setCopyState('idle')
  }

  return {
    linkFallback,
    copyState,
    canCopyDiagnostics,
    handleOpenLink,
    handleCopyDiagnostics,
    reset,
  }
}

function ContributionGrid({
  onOpenLink,
  copyState,
  canCopyDiagnostics,
  onCopyDiagnostics,
  t,
}: {
  onOpenLink: (label: string, url: string) => void
  copyState: 'idle' | 'copied' | 'failed'
  canCopyDiagnostics: boolean
  onCopyDiagnostics: () => void
  t: Translate
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <ContributionCard
          title={t(SPONSOR_SUPPORT_PATH.titleKey)}
          description={t(SPONSOR_SUPPORT_PATH.descriptionKey)}
          ctaLabel={t(SPONSOR_SUPPORT_PATH.ctaLabelKey)}
          icon={SPONSOR_SUPPORT_PATH.icon}
          tone={SPONSOR_SUPPORT_PATH.tone}
          autoFocus={true}
          onAction={() => onOpenLink(t(SPONSOR_SUPPORT_PATH.labelKey), SPONSOR_SUPPORT_PATH.url)}
        />
      </div>
      {CONTRIBUTION_PATHS.map((path) => {
        const secondaryLink = path.secondaryLink

        return (
          <ContributionCard
            key={path.titleKey}
            title={t(path.titleKey)}
            description={t(path.descriptionKey)}
            ctaLabel={t(path.ctaLabelKey)}
            icon={path.icon}
            tone={path.tone}
            onAction={() => onOpenLink(t(path.labelKey), path.url)}
            secondaryAction={secondaryLink ? (
              <ContributionLinkButton
                label={t(secondaryLink.ctaLabelKey)}
                tone={path.tone}
                accented={false}
                onAction={() => onOpenLink(t(secondaryLink.labelKey), secondaryLink.url)}
              />
            ) : undefined}
          />
        )
      })}
      <ContributionCard
        title={t('feedback.reportBug.title')}
        description={t('feedback.reportBug.description')}
        ctaLabel={t('feedback.reportBug.cta')}
        icon={Bug}
        tone="red"
        onAction={() => onOpenLink(t('feedback.reportBug.linkLabel'), TOLARIA_GITHUB_ISSUES_URL)}
        secondaryAction={(
          <BugReportActions
            copyState={copyState}
            canCopyDiagnostics={canCopyDiagnostics}
            onCopyDiagnostics={onCopyDiagnostics}
            t={t}
          />
        )}
      />
    </div>
  )
}

export function FeedbackDialog({
  open,
  onClose,
  buildNumber,
  locale = 'en',
  releaseChannel,
}: FeedbackDialogProps) {
  const t = createTranslator(locale)
  const detectedBuildNumber = useBuildNumber()
  const resolvedBuildNumber = buildNumber ?? detectedBuildNumber
  const diagnosticsBundle = useMemo(
    () => buildSanitizedDiagnosticBundle({ buildNumber: resolvedBuildNumber, releaseChannel }),
    [releaseChannel, resolvedBuildNumber],
  )
  const handleRequestClose = useDialogReturnFocus(open, onClose)
  const {
    linkFallback,
    copyState,
    canCopyDiagnostics,
    handleOpenLink,
    handleCopyDiagnostics,
    reset,
  } = useFeedbackDialogActions(diagnosticsBundle)

  useEffect(() => startFeedbackDiagnosticsCapture(), [])

  const handleClose = () => {
    reset()
    handleRequestClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[820px]" data-testid="feedback-dialog">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <Megaphone size={18} weight="duotone" />
            {t('feedback.title')}
          </DialogTitle>
          <DialogDescription>
            {t('feedback.description')}
          </DialogDescription>
        </DialogHeader>

        <LinkFallbackBanner linkFallback={linkFallback} t={t} />
        <ContributionGrid
          onOpenLink={handleOpenLink}
          copyState={copyState}
          canCopyDiagnostics={canCopyDiagnostics}
          onCopyDiagnostics={handleCopyDiagnostics}
          t={t}
        />
      </DialogContent>
    </Dialog>
  )
}
