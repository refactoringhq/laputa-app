import { Bug, Chats as MessagesSquare, GitPullRequest, Lightbulb, Newspaper } from '@phosphor-icons/react'
import circleCiDarkLogo from '../assets/sponsors/circleci-dark.svg'
import circleCiLightLogo from '../assets/sponsors/circleci-light.svg'
import codacyDarkLogo from '../assets/sponsors/codacy-dark.svg'
import codacyLightLogo from '../assets/sponsors/codacy-light.svg'
import codeSceneDarkLogo from '../assets/sponsors/codescene-dark.svg'
import codeSceneLightLogo from '../assets/sponsors/codescene-light.svg'
import unblockedDarkLogo from '../assets/sponsors/unblocked-dark.svg'
import unblockedLightLogo from '../assets/sponsors/unblocked-light.svg'
import type { TranslationKey } from '../lib/i18n'

const CONTRIBUTION_LINK_UTM = 'utm_source=tolaria&utm_medium=app&utm_campaign=refactoring'

function withContributionUtm(url: string): string {
  return `${url}?${CONTRIBUTION_LINK_UTM}`
}

export const REFACTORING_HOME_URL = withContributionUtm('https://refactoring.fm/')
export const CODACY_HOME_URL = withContributionUtm('https://www.codacy.com/')
export const CODESCENE_HOME_URL = withContributionUtm('https://codescene.com/')
export const CIRCLECI_HOME_URL = withContributionUtm('https://circleci.com/')
export const UNBLOCKED_HOME_URL = withContributionUtm('https://getunblocked.com/')
export const TOLARIA_DEVELOPMENT_ARTICLE_URL = 'https://refactoring.fm/p/introducing-the-tolaria-alliance'
export const TOLARIA_DOCS_URL = 'https://refactoringhq.github.io/tolaria/'
export const TOLARIA_FIRST_LAUNCH_DOCS_URL = `${TOLARIA_DOCS_URL}start/first-launch`
export const TOLARIA_PRODUCT_BOARD_URL = 'https://tolaria.canny.io/'
export const TOLARIA_GITHUB_DISCUSSIONS_URL = 'https://github.com/refactoringhq/tolaria/discussions'
export const TOLARIA_GITHUB_CONTRIBUTING_URL = 'https://github.com/refactoringhq/tolaria/blob/main/CONTRIBUTING.md'
export const TOLARIA_GITHUB_ISSUES_URL = 'https://github.com/refactoringhq/tolaria/issues'
export const TOLARIA_GITHUB_PULL_REQUESTS_URL = 'https://github.com/refactoringhq/tolaria/pulls'

export type ContributionTone = 'blue' | 'green' | 'yellow' | 'purple' | 'red'
export type ContributionIcon = typeof Lightbulb
export type ContributionAnalyticsAction =
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

export interface ContributionLink {
  analyticsAction: ContributionAnalyticsAction
  ctaLabelKey: TranslationKey
  labelKey: TranslationKey
  url: string
}

export interface ContributionPath extends ContributionLink {
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  icon: ContributionIcon
  tone: ContributionTone
  secondaryLink?: ContributionLink
}

export interface SponsorLogo {
  analyticsAction: ContributionAnalyticsAction
  name: string
  url: string
  tooltipKey: TranslationKey
  darkLogo: string
  lightLogo: string
}

export interface ContributionTextLink {
  analyticsAction: ContributionAnalyticsAction
  textKey: TranslationKey
  labelKey: TranslationKey
  url: string
}

export const CONTRIBUTION_ANALYTICS_EVENT = 'contribution_action_clicked'
export const CONTRIBUTION_ANALYTICS_SURFACE = 'contribute_dialog'

export const NEWSLETTER_PATH = {
  analyticsAction: 'newsletter_refactoring',
  titleKey: 'feedback.newsletter.title',
  descriptionKey: 'feedback.newsletter.description',
  ctaLabelKey: 'feedback.newsletter.cta',
  labelKey: 'feedback.newsletter.linkLabel',
  url: REFACTORING_HOME_URL,
  icon: Newspaper,
  tone: 'blue',
} satisfies ContributionPath

export const SPONSOR_LOGOS = [
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
] satisfies SponsorLogo[]

export const SPONSOR_DEVELOPMENT_ARTICLE_LINK = {
  analyticsAction: 'sponsors_development_article',
  textKey: 'feedback.sponsors.developmentLinkText',
  labelKey: 'feedback.sponsors.developmentLinkLabel',
  url: TOLARIA_DEVELOPMENT_ARTICLE_URL,
} satisfies ContributionTextLink

export const CONTRIBUTION_PATHS = [
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
] satisfies ContributionPath[]

export const BUG_REPORT_PATH = {
  analyticsAction: 'issues',
  titleKey: 'feedback.reportBug.title',
  descriptionKey: 'feedback.reportBug.description',
  ctaLabelKey: 'feedback.reportBug.cta',
  labelKey: 'feedback.reportBug.linkLabel',
  url: TOLARIA_GITHUB_ISSUES_URL,
  icon: Bug,
  tone: 'red',
} satisfies ContributionPath
