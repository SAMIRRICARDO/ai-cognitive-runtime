import { handleLinkedInWebhook } from '../workers/linkedinWebhook.js';

const payload = {
  prospect_name:   process.argv[2] || 'Prospect',
  company:         process.argv[3] || 'Empresa',
  job_title:       process.argv[4] || 'Cargo',
  linkedin_url:    process.argv[5] || '',
  message_content: process.argv[6] || '',
};

handleLinkedInWebhook(payload).then(result => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err.message);
  process.exit(1);
});
