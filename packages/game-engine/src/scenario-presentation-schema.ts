import { z } from 'zod';

export const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9._-]*$/,
    'нужен идентификатор из букв, цифр, точек, дефисов и подчёркиваний',
  )
  .refine(
    (id) => !['__proto__', 'constructor', 'prototype'].includes(id),
    'недопустимый идентификатор',
  );

const labelSchema = z.string().trim().min(1);
const namedItemSchema = z.object({ id: identifierSchema, label: labelSchema }).strict();

export const presentationSchema = z
  .object({
    branding: z
      .object({
        title: labelSchema,
        eyebrow: labelSchema,
        heading: labelSchema,
        description: labelSchema,
      })
      .strict(),
    stages: z.array(namedItemSchema).min(1),
    properties: z.array(namedItemSchema),
    metricOrder: z.array(identifierSchema).min(1),
    stageStateLabels: z
      .object({ AS_IS: labelSchema, AI_ENABLED: labelSchema, BROKEN: labelSchema })
      .strict(),
    outcomeLabels: z
      .object({
        CRITICAL_METRIC: labelSchema,
        AI_NOT_EMBEDDED: labelSchema,
        BROKEN_STAGES_REMAIN: labelSchema,
      })
      .strict(),
    copy: z
      .object({
        metricBoardLabel: labelSchema,
        stageSelectionTitle: labelSchema,
        stageMapTitle: labelSchema,
        stageMapEyebrow: labelSchema,
        victoryMapTitle: labelSchema,
        activeActionLabel: labelSchema,
        activationRequirementsTitle: labelSchema,
        activatedActionTemplate: labelSchema,
        blockedActivationBrokenTemplate: labelSchema,
        blockedActivationRepairedTemplate: labelSchema,
        victoryText: labelSchema,
      })
      .strict(),
  })
  .strict();
