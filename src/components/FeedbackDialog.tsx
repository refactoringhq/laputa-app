import { ArrowUpRight, Bug, Chats as MessagesSquare, Check, Copy, GitPullRequest, Handshake, Lightbulb, Megaphone, Newspaper } from '@phosphor-icons/react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import circleCiDarkLogo from '@/assets/sponsors/circleci-dark.svg'
import circleCiLightLogo from '@/assets/sponsors/circleci-light.svg'
import codacyDarkLogo from '@/assets/sponsors/codacy-dark.svg'
import codacyLightLogo from '@/assets/sponsors/codacy-light.svg'
import codeSceneDarkLogo from '@/assets/sponsors/codescene-dark.svg'
import codeSceneLightLogo from '@/assets/sponsors/codescene-light.svg'
import unblockedDarkLogo from '@/assets/sponsors/unblocked-dark.svg'
import unblockedLightLogo from '@/assets/sponsors/unblocked-light.svg'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CIRCLECI_HOME_URL,
  CODACY_HOME_URL,
  CODESCENE_HOME_URL,
  REFACTORING_HOME_URL,
  TOLARIA_DEVELOPMENT_ARTICLE_URL,
  TOLARIA_GITHUB_CONTRIBUTING_URL,
  TOLARIA_GITHUB_DISCUSSIONS_URL,
  TOLARIA_GITHUB_ISSUES_URL,
  TOLARIA_GITHUB_PULL_REQUESTS_URL,
  TOLARIA_PRODUCT_BOARD_URL,
  UNBLOCKED_HOME_URL,
} from '../constants/feedback'
import {
  buildSanitizedDiagnosticBundle,
  startFeedbackDiagnosticsCapture,
} from '../lib/feedbackDiagnostics'
import { trackEvent } from '../lib/telemetry'
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
  className?: string
  inlineAction?: boolean
  secondaryAction?: ReactNode
}

interface LinkFallback {
  label: string
  url: string
}

interface ContributionPath {
  analyticsAction: ContributionAnalyticsAction
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
  analyticsAction: ContributionAnalyticsAction
  ctaLabelKey: TranslationKey
  labelKey: TranslationKey
  url: string
}

interface SponsorLogo {
  analyticsAction: ContributionAnalyticsAction
  name: string
  url: string
  tooltipKey: TranslationKey
  darkLogo: string
  lightLogo: string
}

const EMPTY_DIALOG_OPENER: ReturnType<typeof takeFeedbackDialogOpener> = {
  element: null,
  reopenCommandPalette: false,
}

type ContributionTone = 'blue' | 'green' | 'yellow' | 'purple' | 'red'
type ContributionAnalyticsAction =
  | 'newsletter_refactoring'
  | 'sponsor_codacy'
  | 'sponsor_codescene'
  | 'sponsor_circleci'
  | 'sponsor_unblocked'
  | 'sponsors_development_article'
  | 'feature_requests'
  | 'discussions'
  | 'pull_requests'
  | 'contributing_guide'
  | 'issues'
  | 'copy_diagnostics'

const CONTRIBUTION_ANALYTICS_EVENT = 'contribution_action_clicked'
const CONTRIBUTION_ANALYTICS_SURFACE = 'contribute_dialog'

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

const NEWSLETTER_PATH = {
  analyticsAction: 'newsletter_refactoring',
  titleKey: 'feedback.newsletter.title',
  descriptionKey: 'feedback.newsletter.description',
  ctaLabelKey: 'feedback.newsletter.cta',
  labelKey: 'feedback.newsletter.linkLabel',
  url: REFACTORING_HOME_URL,
  icon: Newspaper,
  tone: 'blue',
} satisfies ContributionPath

const SPONSOR_LOGOS: SponsorLogo[] = [
  {
    analyticsAction: 'sponsor_codacy',
    name: 'Codacy',
    url: CODACY_HOME_URL,
    tooltipKey: 'feedback.sponsors.codacyTooltip',
    darkLogo: codacyDarkLogo,
    lightLogo: codacyLightLogo,
  },
  {
    analyticsAction: 'sponsor_codescene',
    name: 'CodeScene',
    url: CODESCENE_HOME_URL,
    tooltipKey: 'feedback.sponsors.codeSceneTooltip',
    darkLogo: codeSceneDarkLogo,
    lightLogo: codeSceneLightLogo,
  },
  {
    analyticsAction: 'sponsor_circleci',
    name: 'CircleCI',
    url: CIRCLECI_HOME_URL,
    tooltipKey: 'feedback.sponsors.circleCiTooltip',
    darkLogo: circleCiDarkLogo,
    lightLogo: circleCiLightLogo,
  },
  {
    analyticsAction: 'sponsor_unblocked',
    name: 'Unblocked',
    url: UNBLOCKED_HOME_URL,
    tooltipKey: 'feedback.sponsors.unblockedTooltip',
    darkLogo: unblockedDarkLogo,
    lightLogo: unblockedLightLogo,
  },
]

const CONTRIBUTION_PATHS: ContributionPath[] = [
  {
    analyticsAction: 'feature_requests',
    titleKey: 'feedback.featureRequests.title',
    descriptionKey: 'feedback.featureRequests.description',
    ctaLabelKey: 'feedback.featureRequests.cta',
    labelKey: 'feedback.featureRequests.linkLabel',
    url: TOLARIA_PRODUCT_BOARD_URL,
    icon: Lightbulb,
    tone: 'green',
  },
  {
    analyticsAction: 'discussions',
    titleKey: 'feedback.discussions.title',
    descriptionKey: 'feedback.discussions.description',
    ctaLabelKey: 'feedback.discussions.cta',
    labelKey: 'feedback.discussions.linkLabel',
    url: TOLARIA_GITHUB_DISCUSSIONS_URL,
    icon: MessagesSquare,
    tone: 'purple',
  },
  {
    analyticsAction: 'pull_requests',
    titleKey: 'feedback.contributeCode.title',
    descriptionKey: 'feedback.contributeCode.description',
    ctaLabelKey: 'feedback.contributeCode.cta',
    labelKey: 'feedback.contributeCode.linkLabel',
    url: TOLARIA_GITHUB_PULL_REQUESTS_URL,
    icon: GitPullRequest,
    tone: 'yellow',
    secondaryLink: {
      analyticsAction: 'contributing_guide',
      ctaLabelKey: 'feedback.contributingGuide.cta',
      labelKey: 'feedback.contributingGuide.linkLabel',
      url: TOLARIA_GITHUB_CONTRIBUTING_URL,
    },
  },
]

function trackContributionAction(action: ContributionAnalyticsAction): void {
  trackEvent(CONTRIBUTION_ANALYTICS_EVENT, {
    action,
    surface: CONTRIBUTION_ANALYTICS_SURFACE,
  })
}

function openTrackedContributionLink(
  action: ContributionAnalyticsAction,
  label: string,
  url: string,
  onOpenLink: (label: string, url: string) => void,
): void {
  trackContributionAction(action)
  onOpenLink(label, url)
}

function ContributionLinkButton({
  label,
  tone,
  onAction,
  autoFocus = false,
  accented = true,
  className,
}: {
  label: string
  tone: ContributionTone
  onAction: () => void
  autoFocus?: boolean
  accented?: boolean
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'w-full justify-between',
        className,
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
  className,
  inlineAction = false,
  secondaryAction,
}: ContributionCardProps) {
  const compactActionClassName = secondaryAction ? 'min-w-0 px-3 text-sm' : undefined
  const primaryAction = (
    <ContributionLinkButton
      label={ctaLabel}
      tone={tone}
      autoFocus={autoFocus}
      className={cn(inlineAction && 'sm:w-auto sm:min-w-64', compactActionClassName)}
      onAction={onAction}
    />
  )

  return (
    <Card className={cn('gap-4 border-border/70 py-4 shadow-none', className)}>
      <CardHeader className="gap-3 px-4">
        <div className={cn(
          'flex gap-3',
          inlineAction ? 'flex-col sm:flex-row sm:items-center sm:justify-between' : 'items-center',
        )}>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className={cn('rounded-md p-2', Reflect.get(CONTRIBUTION_TONE_CLASSES, tone))}>
              <Icon size={16} />
            </span>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </div>
          {inlineAction ? primaryAction : null}
        </div>
        <CardDescription className="whitespace-pre-line text-sm leading-6 text-muted-foreground">
          {description}
        </CardDescription>
      </CardHeader>
      {inlineAction ? null : (
        <CardContent className={cn('px-4', secondaryAction && 'grid gap-2 sm:grid-cols-2')}>
          {primaryAction}
          {secondaryAction}
        </CardContent>
      )}
    </Card>
  )
}

function SponsorLogoCard({
  className,
  onOpenLink,
  t,
}: {
  className?: string
  onOpenLink: (label: string, url: string) => void
  t: Translate
}) {
  return (
    <Card className={cn('gap-4 border-border/70 py-4 shadow-none', className)}>
      <CardHeader className="gap-3 px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className={cn('rounded-md p-2', CONTRIBUTION_TONE_CLASSES.blue)}>
              <Handshake size={16} />
            </span>
            <CardTitle className="text-sm font-semibold">{t('feedback.sponsors.title')}</CardTitle>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto lg:flex lg:justify-end">
            {SPONSOR_LOGOS.map((sponsor) => (
              <Tooltip key={sponsor.name}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 bg-transparent px-1.5 shadow-none hover:bg-transparent hover:opacity-80 lg:w-32"
                    aria-label={t('feedback.sponsors.logoLinkLabel', { sponsor: sponsor.name })}
                    onClick={() => openTrackedContributionLink(
                      sponsor.analyticsAction,
                      sponsor.name,
                      sponsor.url,
                      onOpenLink,
                    )}
                  >
                    <img
                      className="max-h-6 max-w-[7.25rem] object-contain dark:hidden"
                      src={sponsor.darkLogo}
                      alt=""
                    />
                    <img
                      className="hidden max-h-6 max-w-[7.25rem] object-contain dark:block"
                      src={sponsor.lightLogo}
                      alt=""
                      aria-hidden="true"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t(sponsor.tooltipKey)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
        <CardDescription className="text-sm leading-6 text-muted-foreground">
          {t('feedback.sponsors.description')}{' '}
          {t('feedback.sponsors.developmentSentencePrefix')}{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 align-baseline text-sm leading-6 text-[var(--accent-blue)]"
            onClick={() => openTrackedContributionLink(
              'sponsors_development_article',
              t('feedback.sponsors.developmentLinkLabel'),
              TOLARIA_DEVELOPMENT_ARTICLE_URL,
              onOpenLink,
            )}
          >
            {t('feedback.sponsors.developmentLinkText')}
          </Button>
          {t('feedback.sponsors.developmentSentenceSuffix')}
        </CardDescription>
      </CardHeader>
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
  buttonClassName,
  copyState,
  canCopyDiagnostics,
  onCopyDiagnostics,
  t,
}: {
  buttonClassName?: string
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
        className={cn('w-full justify-between', buttonClassName)}
        onClick={() => {
          trackContributionAction('copy_diagnostics')
          onCopyDiagnostics()
        }}
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
      <ContributionCard
        className="sm:col-span-2"
        title={t(NEWSLETTER_PATH.titleKey)}
        description={t(NEWSLETTER_PATH.descriptionKey)}
        ctaLabel={t(NEWSLETTER_PATH.ctaLabelKey)}
        icon={NEWSLETTER_PATH.icon}
        tone={NEWSLETTER_PATH.tone}
        autoFocus={true}
        inlineAction={true}
        onAction={() => openTrackedContributionLink(
          NEWSLETTER_PATH.analyticsAction,
          t(NEWSLETTER_PATH.labelKey),
          NEWSLETTER_PATH.url,
          onOpenLink,
        )}
      />
      <SponsorLogoCard className="sm:col-span-2" onOpenLink={onOpenLink} t={t} />
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
            onAction={() => openTrackedContributionLink(
              path.analyticsAction,
              t(path.labelKey),
              path.url,
              onOpenLink,
            )}
            secondaryAction={secondaryLink ? (
              <ContributionLinkButton
                label={t(secondaryLink.ctaLabelKey)}
                tone={path.tone}
                accented={false}
                className="min-w-0 px-3 text-sm"
                onAction={() => openTrackedContributionLink(
                  secondaryLink.analyticsAction,
                  t(secondaryLink.labelKey),
                  secondaryLink.url,
                  onOpenLink,
                )}
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
        onAction={() => openTrackedContributionLink(
          'issues',
          t('feedback.reportBug.linkLabel'),
          TOLARIA_GITHUB_ISSUES_URL,
          onOpenLink,
        )}
        secondaryAction={(
          <BugReportActions
            buttonClassName="min-w-0 px-3 text-sm"
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
