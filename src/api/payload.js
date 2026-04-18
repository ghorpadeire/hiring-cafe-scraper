'use strict';

// Tech synonym expansion — used for both the API query and client-side post-filter.
// Maps canonical tech terms → related keywords we accept in job text.
const TECH_SYNONYMS = {
  java:       ['java', 'spring', 'spring boot', 'hibernate', 'maven', 'gradle', 'jvm', 'quarkus', 'micronaut', 'jakarta ee', 'j2ee', 'java ee', 'jpa', 'jsf', 'struts', 'tomcat', 'jboss'],
  kotlin:     ['kotlin', 'spring boot', 'jvm', 'android'],
  python:     ['python', 'django', 'flask', 'fastapi', 'sqlalchemy', 'celery', 'pytest', 'pydantic', 'pandas', 'numpy', 'pytorch', 'tensorflow', 'scikit', 'jupyter'],
  javascript: ['javascript', 'js', 'node', 'nodejs', 'express', 'npm', 'webpack', 'babel', 'eslint'],
  typescript: ['typescript', 'ts', 'angular', 'nestjs', 'next.js', 'nextjs', 'node'],
  react:      ['react', 'reactjs', 'react.js', 'jsx', 'redux', 'next.js', 'nextjs', 'gatsby', 'react native'],
  angular:    ['angular', 'angularjs', 'ng', 'rxjs', 'typescript', 'ngrx'],
  vue:        ['vue', 'vuejs', 'vue.js', 'nuxt', 'nuxtjs', 'vuex'],
  go:         ['golang', 'go lang', 'goroutine', 'gin', 'echo framework'],
  rust:       ['rust', 'cargo', 'tokio', 'actix', 'wasm', 'webassembly'],
  dotnet:     ['.net', 'dotnet', 'c#', 'asp.net', 'blazor', 'ef core', 'entity framework', 'azure devops'],
  php:        ['php', 'laravel', 'symfony', 'wordpress', 'composer'],
  ruby:       ['ruby', 'rails', 'ruby on rails', 'ror', 'sinatra', 'rspec'],
  swift:      ['swift', 'swiftui', 'ios', 'xcode', 'objective-c', 'cocoa'],
  android:    ['android', 'kotlin', 'java', 'jetpack compose', 'android studio'],
  devops:     ['devops', 'ci/cd', 'jenkins', 'github actions', 'gitlab ci', 'terraform', 'ansible', 'kubernetes', 'k8s', 'helm', 'argocd', 'docker'],
  cloud:      ['aws', 'azure', 'gcp', 'google cloud', 'cloud', 'lambda', 'ec2', 's3', 'cloudformation'],
  kubernetes: ['kubernetes', 'k8s', 'helm', 'docker', 'container', 'microservices', 'istio', 'argocd', 'flux'],
  data:       ['data engineer', 'data scientist', 'data analyst', 'spark', 'kafka', 'airflow', 'dbt', 'snowflake', 'databricks', 'etl', 'sql', 'bigquery', 'redshift'],
  ml:         ['machine learning', 'ml', 'deep learning', 'llm', 'ai', 'artificial intelligence', 'pytorch', 'tensorflow', 'scikit-learn', 'huggingface', 'openai'],
  security:   ['security', 'cybersecurity', 'penetration testing', 'devsecops', 'sast', 'dast', 'owasp', 'soc', 'siem', 'vulnerability'],
  scala:      ['scala', 'akka', 'play framework', 'spark', 'sbt'],
  elixir:     ['elixir', 'erlang', 'phoenix', 'otp'],
  haskell:    ['haskell', 'functional', 'purescript'],
  sql:        ['sql', 'postgresql', 'postgres', 'mysql', 'oracle', 'mssql', 'sql server', 'database', 'dba'],
};

/**
 * Expands tech terms for both the API technologyKeywordsQuery and client-side filter.
 * Returns { queryString, filterTerms }.
 */
function expandTech(techInput) {
  if (!techInput) return { queryString: '', filterTerms: [] };

  const terms = techInput.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const filterTerms = new Set();

  // Add originals
  terms.forEach(t => filterTerms.add(t));

  // Expand with synonyms
  for (const term of terms) {
    for (const [canonical, synonyms] of Object.entries(TECH_SYNONYMS)) {
      if (canonical === term || synonyms.some(s => s === term || s.startsWith(term))) {
        synonyms.forEach(s => filterTerms.add(s));
        filterTerms.add(canonical);
      }
    }
  }

  // The API query uses the original terms joined (it does its own expansion)
  return {
    queryString: terms.join(' '),
    filterTerms: Array.from(filterTerms),
  };
}

// Seniority level mapping — user-friendly → API values
const SENIORITY_MAP = {
  all:    ['No Prior Experience Required', 'Entry Level', 'Mid Level', 'Senior Level', 'Lead', 'Manager', 'Director', 'VP', 'C-Suite'],
  junior: ['No Prior Experience Required', 'Entry Level'],
  entry:  ['No Prior Experience Required', 'Entry Level'],
  mid:    ['Mid Level'],
  middle: ['Mid Level'],
  senior: ['Senior Level', 'Lead'],
  lead:   ['Lead', 'Senior Level'],
  staff:  ['Lead', 'Senior Level'],
  manager:   ['Manager'],
  director:  ['Director'],
  vp:        ['VP'],
  executive: ['C-Suite', 'VP', 'Director'],
};

function resolveSeniority(input) {
  if (!input) return SENIORITY_MAP['all'];
  const key = input.toLowerCase().trim();
  if (SENIORITY_MAP[key]) return SENIORITY_MAP[key];
  // Try comma-separated list
  const parts = key.split(',').map(s => s.trim()).filter(Boolean);
  const result = new Set();
  for (const p of parts) {
    (SENIORITY_MAP[p] || []).forEach(v => result.add(v));
  }
  return result.size > 0 ? Array.from(result) : SENIORITY_MAP['all'];
}

/**
 * Builds the POST body for /api/search-jobs.
 */
function buildPayload(config, page) {
  const { tech, query, location, days, remote, seniority, pageSize = 1000 } = config;
  const { queryString } = expandTech(tech);

  const workplaceTypes = remote
    ? ['Remote']
    : ['Remote', 'Hybrid', 'Onsite'];

  const seniorityLevels = resolveSeniority(seniority);

  return {
    size: pageSize,
    page,
    searchState: {
      locations: [location],
      searchQuery: query || queryString || '',
      technologyKeywordsQuery: queryString,
      requirementsKeywordsQuery: '',
      workplaceTypes,
      commitmentTypes: ['Full Time', 'Part Time', 'Contract', 'Internship', 'Temporary'],
      seniorityLevel: seniorityLevels,
      roleTypes: ['Individual Contributor', 'People Manager'],
      dateFetchedPastNDays: days || 90,
      sortBy: 'default',
    }
  };
}

module.exports = { buildPayload, expandTech, resolveSeniority, TECH_SYNONYMS };
