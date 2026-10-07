import { authorizeAdmin } from '$lib/server/authz';
import { loadDraft } from '../../../../../lib/admin/draft/draft-source.server';
import { createProblemsHandler } from '../../../problems-handler';

export const GET = createProblemsHandler({ authorize: authorizeAdmin, loadDraft });
