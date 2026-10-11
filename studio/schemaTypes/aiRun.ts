import {defineField, defineType} from 'sanity'

// One AI draft run. It is the audit record: what went in, what the model said, what the validators found. Only ever created as a DRAFT id.
export const aiRun = defineType({
  name: 'aiRun',
  title: 'AI draft run (audit)',
  type: 'document',
  readOnly: true,
  fields: [
    defineField({name: 'idempotencyKey', type: 'string'}),
    defineField({name: 'model', type: 'string'}),
    defineField({name: 'promptVersion', type: 'string'}),
    defineField({name: 'inputHash', type: 'string'}),
    defineField({name: 'status', type: 'string', options: {list: ['ready_for_review', 'needs_human', 'failed']}}),
    defineField({name: 'validatorReport', type: 'text', rows: 8}),
    defineField({name: 'missingInformation', type: 'array', of: [{type: 'string'}]}),
    defineField({name: 'outputJson', type: 'text', rows: 12}),
    defineField({name: 'createdAt', type: 'datetime'}),
  ],
  preview: {select: {title: 'status', subtitle: 'createdAt'}},
})
