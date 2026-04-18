'use strict';

const cleanHtml = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Normalises a raw job object from the hiring.cafe API into a clean, consistent shape.
 */
function normalise(raw) {
  return {
    id:           raw.id           || raw._id             || '',
    title:        raw.title        || raw.job_title        || raw.name         || '',
    company:      raw.company      || raw.employer         || raw.organization  || raw.company_name || '',
    location:     raw.location     || raw.city             || raw.office_location || 'Unknown',
    workplaceType: raw.workplace_type || raw.workplaceType  || raw.work_type    || '',
    commitment:   raw.commitment_type || raw.commitmentType || raw.employment_type || raw.job_type || '',
    seniority:    raw.seniority_level || raw.seniorityLevel || raw.experience_level || '',
    salary:       raw.salary_range || raw.salary           || raw.compensation  || raw.pay_range || '',
    currency:     raw.currency     || raw.salary_currency  || '',
    description:  cleanHtml(raw.description || raw.cleaned_description || raw.job_description || '').substring(0, 800),
    applyUrl:     raw.apply_url    || raw.applyUrl         || raw.url           || raw.job_url || raw.application_url || '',
    postedDate:   raw.date_fetched || raw.dateFetched      || raw.posted_at     || raw.created_at || raw.date_posted || '',
    views:        raw.view_count   || raw.views            || 0,
    applications: raw.application_count || raw.applications || raw.applicant_count || 0,
    source:       raw.source       || raw.board_token      || '',
    companySize:  raw.company_size || raw.companySize      || '',
    benefits:     Array.isArray(raw.benefits) ? raw.benefits.slice(0, 5) : [],
    skills:       Array.isArray(raw.skills)   ? raw.skills.slice(0, 10)  : [],
  };
}

module.exports = { normalise };
