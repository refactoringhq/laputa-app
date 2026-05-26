import { CircleNotch as Loader2, FolderOpen, Plus, Rocket, Warning as AlertTriangle } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { OnboardingShell } from './OnboardingShell'
import { Button } from '@/components/ui/button'
import tolariaIcon from '@/assets/tolaria-icon.svg'

interface WelcomeScreenProps {
  mode: 'welcome' | 'vault-missing'
  missingPath?: string
  defaultVaultPath: string
  onCreateVault: () => void
  onRetryCreateVault: () => void
  onCreateEmptyVault: () => void
  onOpenFolder: () => void
  isOffline: boolean
  creatingAction: 'template' | 'empty' | null
  error: string | null
  canRetryTemplate: boolean
}

interface WelcomeScreenPresentation {
  heroBackground: string
  heroIcon: ReactNode
  openFolderLabel: string
  subtitle: string
  templateDescription: string
  title: string
}

type WelcomeActionButtonRef = React.RefObject<HTMLButtonElement | null>

interface WelcomeAction {
  disabled: boolean
  run: () => void
}

function isWelcomeActivationKey(event: globalThis.KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' '
}

function isWelcomeNavigationKey(event: globalThis.KeyboardEvent): boolean {
  return event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp'
}

function nextWelcomeActionIndex(
  currentIndex: number,
  event: globalThis.KeyboardEvent,
  actionCount: number,
): number {
  const direction = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1
  return (currentIndex + direction + actionCount) % actionCount
}

function focusBelongsToWelcomeActions(
  activeElement: Element | null,
  actionButtonRefs: WelcomeActionButtonRef[],
): boolean {
  return activeElement === document.body
    || actionButtonRefs.some(({ current }) => current === activeElement)
}

function getFocusedWelcomeActionIndex(
  activeElement: Element | null,
  actionButtonRefs: WelcomeActionButtonRef[],
): number {
  return Math.max(
    0,
    actionButtonRefs.findIndex(({ current }) => current === activeElement),
  )
}

function focusWelcomeAction(
  actionButtonRefs: WelcomeActionButtonRef[],
  actionIndex: number,
): void {
  actionButtonRefs.at(actionIndex)?.current?.focus()
}

function triggerWelcomeAction(
  actionIndex: number,
  actions: WelcomeAction[],
): void {
  const action = actions.at(actionIndex)
  if (action && !action.disabled) action.run()
}

const CARD_STYLE: React.CSSProperties = {
  width: 'min(520px, 100%)',
  background: 'var(--background)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: 48,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 24,
}

const ICON_WRAP_STYLE: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const BRAND_ICON_STYLE: React.CSSProperties = {
  width: 64,
  height: 64,
  display: 'block',
}

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  letterSpacing: -0.5,
  color: 'var(--foreground)',
  textAlign: 'center',
  margin: 0,
}

const SUBTITLE_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--muted-foreground)',
  textAlign: 'center',
  margin: 0,
}

const DIVIDER_STYLE: React.CSSProperties = {
  width: '100%',
  height: 1,
  background: 'var(--border)',
}

const OPTION_BTN_STYLE: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 16px',
  textAlign: 'left',
  transition: 'background 0.15s',
}

const OPTION_ICON_STYLE: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

const OPTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--foreground)',
  margin: 0,
}

const OPTION_DESC_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted-foreground)',
  margin: 0,
  marginTop: 2,
}

const ERROR_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--destructive)',
  textAlign: 'center',
  margin: 0,
}

const STATUS_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--muted-foreground)',
  textAlign: 'center',
  margin: 0,
}

const ERROR_BLOCK_STYLE: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
}

const RETRY_BUTTON_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  cursor: 'pointer',
  padding: '8px 12px',
  fontSize: 13,
  fontWeight: 600,
}

interface OptionButtonProps {
  icon: React.ReactNode
  iconBg: string
  label: string
  description: string
  loadingLabel?: string
  loadingDescription?: string
  onClick: () => void
  disabled: boolean
  loading?: boolean
  testId: string
  autoFocus?: boolean
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}

function OptionButton({
  icon,
  iconBg,
  label,
  description,
  loadingLabel,
  loadingDescription,
  onClick,
  disabled,
  loading,
  testId,
  autoFocus = false,
  buttonRef,
}: OptionButtonProps) {
  const [hover, setHover] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      style={{
        ...OPTION_BTN_STYLE,
        background: hover ? 'var(--sidebar)' : 'var(--background)',
        opacity: disabled ? 0.7 : 1,
      }}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={testId}
      autoFocus={autoFocus}
      className="h-auto justify-start shadow-none"
      ref={buttonRef}
    >
      <div style={{ ...OPTION_ICON_STYLE, background: iconBg }}>
        {loading ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--muted-foreground)' }} /> : icon}
      </div>
      <div>
        <p style={OPTION_LABEL_STYLE}>{loading ? (loadingLabel ?? label) : label}</p>
        <p style={OPTION_DESC_STYLE}>{loading ? (loadingDescription ?? description) : description}</p>
      </div>
    </Button>
  )
}

function getWelcomeScreenPresentation(
  mode: WelcomeScreenProps['mode'],
  defaultVaultPath: string,
  isOffline: boolean,
): WelcomeScreenPresentation {
  if (mode === 'welcome') {
    return {
      heroBackground: 'transparent',
      heroIcon: <img src={tolariaIcon} alt="Tolaria icon" style={BRAND_ICON_STYLE} />,
      openFolderLabel: 'Open existing vault',
      subtitle: 'Markdown knowledge management for the age of AI',
      templateDescription: isOffline
        ? `Requires internet — clone later. Suggested path: ${defaultVaultPath}`
        : 'Download the getting started vault',
      title: 'Welcome to Tolaria',
    }
  }

  return {
    heroBackground: 'var(--accent-yellow-light)',
    heroIcon: <AlertTriangle size={28} style={{ color: 'var(--accent-orange)' }} />,
    openFolderLabel: 'Choose a different folder',
    subtitle: 'The vault folder could not be found on disk.\nIt may have been moved or deleted.',
    templateDescription: isOffline
      ? `Requires internet — clone later. Suggested path: ${defaultVaultPath}`
      : 'Download the getting started vault',
    title: 'Vault not found',
  }
}

function useWelcomeActionButtons({
  mode,
  busy,
  isOffline,
  onCreateEmptyVault,
  onOpenFolder,
  onCreateVault,
}: Pick<
  WelcomeScreenProps,
  'mode' | 'isOffline' | 'onCreateEmptyVault' | 'onOpenFolder' | 'onCreateVault'
> & {
  busy: boolean
}) {
  const templateActionRef = useRef<HTMLButtonElement>(null)
  const createEmptyActionRef = useRef<HTMLButtonElement>(null)
  const openFolderActionRef = useRef<HTMLButtonElement>(null)
  const actionButtonRefs = useMemo(
    () => [templateActionRef, createEmptyActionRef, openFolderActionRef],
    [],
  )
  const actions = useMemo<WelcomeAction[]>(
    () => ([
      { disabled: isOffline, run: onCreateVault },
      { disabled: false, run: onCreateEmptyVault },
      { disabled: false, run: onOpenFolder },
    ]),
    [isOffline, onCreateEmptyVault, onCreateVault, onOpenFolder],
  )

  useEffect(() => {
    void mode
    if (busy) return

    // WKWebView can ignore `autoFocus`; move focus explicitly so keyboard-only
    // onboarding always starts on the guided template flow.
    focusWelcomeAction(actionButtonRefs, 0)
  }, [actionButtonRefs, busy, mode])

  useEffect(() => {
    if (busy) return

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const activeElement = document.activeElement
      if (!focusBelongsToWelcomeActions(activeElement, actionButtonRefs)) return

      const actionIndex = getFocusedWelcomeActionIndex(activeElement, actionButtonRefs)
      if (isWelcomeNavigationKey(event)) {
        event.preventDefault()
        focusWelcomeAction(
          actionButtonRefs,
          nextWelcomeActionIndex(actionIndex, event, actionButtonRefs.length),
        )
        return
      }

      if (!isWelcomeActivationKey(event)) return

      event.preventDefault()
      triggerWelcomeAction(actionIndex, actions)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [actionButtonRefs, actions, busy])

  return {
    templateActionRef,
    createEmptyActionRef,
    openFolderActionRef,
  }
}

export function WelcomeScreen({
  mode,
  defaultVaultPath,
  onCreateVault,
  onRetryCreateVault,
  onCreateEmptyVault,
  onOpenFolder,
  isOffline,
  creatingAction,
  error,
  canRetryTemplate,
}: WelcomeScreenProps) {
  const busy = creatingAction !== null
  const presentation = getWelcomeScreenPresentation(mode, defaultVaultPath, isOffline)
  const { templateActionRef, createEmptyActionRef, openFolderActionRef } = useWelcomeActionButtons({
    mode,
    busy,
    isOffline,
    onCreateEmptyVault,
    onOpenFolder,
    onCreateVault,
  })

  return (
    <OnboardingShell
      style={{ background: 'var(--sidebar)' }}
      contentStyle={CARD_STYLE}
      testId="welcome-screen"
    >
      <>
        <div
          style={{
            ...ICON_WRAP_STYLE,
            background: presentation.heroBackground,
          }}
        >
          {presentation.heroIcon}
        </div>

        <div style={{ textAlign: 'center' }}>
          <h1 style={TITLE_STYLE}>{presentation.title}</h1>
          <p style={{ ...SUBTITLE_STYLE, marginTop: 8 }}>
            {presentation.subtitle}
          </p>
        </div>

        <div style={DIVIDER_STYLE} />

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <OptionButton
            icon={<Rocket size={18} style={{ color: 'var(--accent-purple)' }} />}
            iconBg="var(--accent-purple-light)"
            label="Get started with a template"
            description={presentation.templateDescription}
            loadingLabel="Downloading template…"
            loadingDescription="Cloning the Getting Started vault template"
            onClick={onCreateVault}
            disabled={busy || isOffline}
            loading={creatingAction === 'template'}
            testId="welcome-create-vault"
            autoFocus
            buttonRef={templateActionRef}
          />

          <OptionButton
            icon={<Plus size={18} style={{ color: 'var(--accent-blue)' }} />}
            iconBg="var(--accent-blue-light)"
            label="Create empty vault"
            description="Start fresh in an empty folder with Tolaria defaults"
            loadingLabel="Creating vault…"
            loadingDescription="Preparing Tolaria defaults in the selected folder"
            onClick={onCreateEmptyVault}
            disabled={busy}
            loading={creatingAction === 'empty'}
            testId="welcome-create-new"
            buttonRef={createEmptyActionRef}
          />

          <OptionButton
            icon={<FolderOpen size={18} style={{ color: 'var(--accent-green)' }} />}
            iconBg="var(--accent-green-light)"
            label={presentation.openFolderLabel}
            description="Point to a folder you already have"
            onClick={onOpenFolder}
            disabled={busy}
            testId="welcome-open-folder"
            buttonRef={openFolderActionRef}
          />
        </div>

        {creatingAction === 'template' && (
          <p style={STATUS_STYLE} data-testid="welcome-status" role="status" aria-live="polite">
            Downloading the Getting Started vault template…
          </p>
        )}

        {error && (
          <div style={ERROR_BLOCK_STYLE}>
            <p style={ERROR_STYLE} data-testid="welcome-error" role="alert" aria-live="assertive">
              {error}
            </p>
            {canRetryTemplate && (
              <Button
                type="button"
                variant="outline"
                style={RETRY_BUTTON_STYLE}
                onClick={onRetryCreateVault}
                data-testid="welcome-retry-template"
                className="shadow-none"
              >
                Retry download
              </Button>
            )}
          </div>
        )}
      </>
    </OnboardingShell>
  )
}
