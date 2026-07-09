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
