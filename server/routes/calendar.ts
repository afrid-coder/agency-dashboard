import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError, readJson, readQuery } from '../http.ts';
import type { AppEnv } from '../auth/context.ts';
import { actorOf, tzOf } from './helpers.ts';
import * as svc from '../services/events.ts';
import { diffDays, zonedToUtc } from '../../shared/dates.ts';
import { eventPatchSchema, eventRangeSchema, eventSchema } from '../../shared/schemas.ts';

export const calendar = new Hono<AppEnv>();

calendar.get('/', async (c) => {
  const q = readQuery(c, eventRangeSchema);
  if (q.to < q.from || diffDays(q.to, q.from) > 62) throw new ApiError(422, 'invalid', 'Ask for at most 62 days at a time.');
  return c.json(await svc.listOccurrences(c.get('org').id, c.get('user').id, q));
});

calendar.post('/', async (c) => {
  const input = await readJson(c, eventSchema.and(z.object({ idempotencyKey: z.string().min(8).max(80).optional() })));
  const r = await svc.createEvent(actorOf(c), input);
  return c.json(r, r.duplicate ? 200 : 201);
});

/** Overlapping events for the chosen people, shown in the event form before saving. */
calendar.post('/conflicts', async (c) => {
  const input = await readJson(
    c,
    z.object({ date: z.string(), startTime: z.string(), endTime: z.string(), timezone: z.string(), attendeeIds: z.array(z.string()).max(30), excludeEventId: z.string().uuid().optional() }),
  );
  const s = zonedToUtc(input.date, input.startTime, input.timezone);
  const e = zonedToUtc(input.date, input.endTime, input.timezone);
  if (e <= s) return c.json([]);
  const people = [...new Set([c.get('user').id, ...input.attendeeIds])];
  const list = await svc.findConflicts(c.get('org').id, c.get('user').id, people, s, e, tzOf(c), input.excludeEventId);
  return c.json(list.slice(0, 5));
});

calendar.get('/:id', async (c) => {
  const { row, attendees } = await svc.getEventForUser(c.get('org').id, c.get('user').id, c.req.param('id'));
  return c.json({
    id: row.id,
    version: row.version,
    title: row.title,
    allDay: row.allDay,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    startDate: row.startDate,
    endDate: row.endDate,
    timezone: row.timezone,
    recurrence: row.recurrence,
    createdBy: row.createdBy,
    attendees: await svc.attendeeResponses(row.id),
    attendeeIds: attendees,
  });
});

calendar.put('/:id', async (c) => {
  const input = await readJson(c, eventPatchSchema);
  await svc.updateEvent(actorOf(c), c.req.param('id'), input.scope, input.occurrenceKey, input.version, input.event);
  return c.json({ ok: true });
});

calendar.delete('/:id', async (c) => {
  const scope = c.req.query('scope') === 'occurrence' ? 'occurrence' : 'series';
  await svc.deleteEvent(actorOf(c), c.req.param('id'), scope, c.req.query('occurrence'));
  return c.json({ ok: true });
});

calendar.post('/:id/restore', async (c) => {
  const body = await readJson(c, z.object({ occurrenceKey: z.string().max(40).nullable().optional() }));
  await svc.restoreEvent(actorOf(c), c.req.param('id'), body.occurrenceKey);
  return c.json({ ok: true });
});

calendar.post('/:id/response', async (c) => {
  const { response } = await readJson(c, z.object({ response: z.enum(['accepted', 'declined']) }));
  await svc.setResponse(actorOf(c), c.req.param('id'), response);
  return c.json({ ok: true });
});
