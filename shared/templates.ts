// Optional starter checklists for common agency workflows. Nothing is added
// unless someone chooses a template.

export type Stage = 'discovery' | 'design' | 'development' | 'review' | 'launch' | 'marketing';

export const STAGES: { value: Stage; label: string; summary: string }[] = [
  { value: 'discovery', label: 'Discovery', summary: 'Goals, audience, scope and sitemap agreed with the client.' },
  { value: 'design', label: 'Design', summary: 'Wireframes, visual direction and approved page designs.' },
  { value: 'development', label: 'Development', summary: 'Build, content entry, integrations and QA.' },
  { value: 'review', label: 'Client review', summary: 'Client feedback rounds and sign-off.' },
  { value: 'launch', label: 'Launch', summary: 'Go-live, redirects, analytics and handover.' },
  { value: 'marketing', label: 'Ongoing marketing', summary: 'SEO, campaigns, reporting and optimisation.' },
];

export interface TaskTemplate {
  title: string;
  priority: 'low' | 'medium' | 'high';
  /** Days after the project start date, used only when a start date is set. */
  offsetDays: number;
  checklist: string[];
}

export const STAGE_TEMPLATES: Record<Stage, TaskTemplate[]> = {
  discovery: [
    { title: 'Kickoff call with client', priority: 'high', offsetDays: 0, checklist: ['Confirm goals and success metrics', 'Identify decision makers', 'Agree timeline and review cadence'] },
    { title: 'Collect brand assets and access', priority: 'medium', offsetDays: 2, checklist: ['Logo files and brand guide', 'Domain and hosting access', 'Analytics and Search Console access'] },
    { title: 'Draft sitemap and scope', priority: 'medium', offsetDays: 5, checklist: ['List pages and templates', 'Note integrations and forms', 'Send scope for client approval'] },
  ],
  design: [
    { title: 'Wireframes for key pages', priority: 'high', offsetDays: 7, checklist: ['Home', 'Service or product page', 'Contact / conversion page'] },
    { title: 'Visual direction and style tiles', priority: 'medium', offsetDays: 10, checklist: ['Type pairing', 'Colour palette with contrast checks', 'Image treatment'] },
    { title: 'Design review with client', priority: 'high', offsetDays: 14, checklist: ['Share prototype link', 'Capture feedback', 'Confirm approved designs'] },
  ],
  development: [
    { title: 'Set up build and staging', priority: 'medium', offsetDays: 15, checklist: ['Repository and environments', 'Staging URL shared with team', 'Content model set up'] },
    { title: 'Build page templates', priority: 'high', offsetDays: 18, checklist: ['Responsive layouts', 'Accessibility pass', 'Forms connected'] },
    { title: 'Content entry and QA', priority: 'medium', offsetDays: 24, checklist: ['Copy and images placed', 'Cross-browser check', 'Performance check'] },
  ],
  review: [
    { title: 'Client review round', priority: 'high', offsetDays: 26, checklist: ['Send review guide', 'Collect consolidated feedback', 'Schedule fixes'] },
    { title: 'Final sign-off', priority: 'high', offsetDays: 30, checklist: ['Confirm all feedback resolved', 'Written approval received'] },
  ],
  launch: [
    { title: 'Launch checklist', priority: 'high', offsetDays: 32, checklist: ['DNS and SSL', '301 redirects', 'Analytics and conversion tracking', 'Sitemap submitted', 'Backups enabled'] },
    { title: 'Client handover', priority: 'medium', offsetDays: 34, checklist: ['CMS training', 'Handover document', 'Support plan confirmed'] },
  ],
  marketing: [
    { title: 'Monthly SEO review', priority: 'medium', offsetDays: 30, checklist: ['Rankings and traffic report', 'Technical issues check', 'Next month keyword plan'] },
    { title: 'Campaign plan', priority: 'medium', offsetDays: 35, checklist: ['Audience and offer', 'Channels and budget', 'Tracking links'] },
    { title: 'Performance report for client', priority: 'medium', offsetDays: 40, checklist: ['Traffic and conversions', 'Wins and learnings', 'Recommendations'] },
  ],
};

/** Standalone checklists that can be added to any task. */
export const CHECKLIST_TEMPLATES: { id: string; label: string; items: string[] }[] = [
  { id: 'discovery-call', label: 'Discovery call', items: ['Business goals', 'Target audience', 'Competitors', 'Budget and timeline', 'Next steps agreed'] },
  { id: 'design-qa', label: 'Design QA', items: ['Spacing and alignment', 'Type scale consistent', 'Colour contrast AA', 'Mobile layouts', 'Hover and focus states'] },
  { id: 'dev-qa', label: 'Development QA', items: ['Chrome, Safari, Firefox', 'iOS and Android', 'Forms submit correctly', 'Lighthouse check', 'Broken link scan'] },
  { id: 'client-review', label: 'Client review', items: ['Review link sent', 'Feedback deadline set', 'Feedback consolidated', 'Changes confirmed'] },
  { id: 'launch', label: 'Website launch', items: ['DNS updated', 'SSL active', 'Redirects tested', 'Analytics firing', 'Search Console sitemap', 'Uptime monitor'] },
  { id: 'monthly-report', label: 'Monthly marketing report', items: ['Traffic summary', 'Conversions', 'Top content', 'Campaign results', 'Recommendations'] },
];
