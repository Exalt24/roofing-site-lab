import {defineArrayMember, defineField, defineType} from 'sanity'

// A completed job is entered ONCE. Services, materials, the neighbourhood page, galleries and related projects are all derived from it.
export const project = defineType({
  name: 'project',
  title: 'Completed project',
  type: 'document',
  groups: [
    {name: 'basics', title: 'The job', default: true},
    {name: 'story', title: 'The story'},
    {name: 'media', title: 'Photos and video'},
    {name: 'review', title: 'Customer review'},
  ],
  fields: [
    defineField({name: 'title', type: 'string', group: 'basics', validation: (r) => r.required().min(10).max(110)}),
    defineField({name: 'slug', type: 'slug', group: 'basics', options: {source: 'title', maxLength: 80}, validation: (r) => r.required()}),
    defineField({name: 'summary', type: 'text', rows: 3, group: 'basics', validation: (r) => r.required().max(300)}),
    defineField({name: 'featured', title: 'Show first on the home page', type: 'boolean', group: 'basics', initialValue: false}),
    defineField({name: 'neighbourhood', type: 'reference', to: [{type: 'neighbourhood'}], group: 'basics', validation: (r) => r.required()}),
    defineField({
      name: 'roofType',
      type: 'string',
      group: 'basics',
      options: {list: ['metal', 'asphalt', 'cedar', 'composite', 'flat', 'skylight', 'solar'], layout: 'radio'},
      validation: (r) => r.required(),
    }),
    defineField({name: 'services', type: 'array', group: 'basics', of: [{type: 'reference', to: [{type: 'service'}]}], validation: (r) => r.required().min(1)}),
    defineField({name: 'materials', type: 'array', group: 'basics', of: [{type: 'reference', to: [{type: 'material'}]}]}),
    defineField({name: 'manufacturer', type: 'string', group: 'basics'}),
    defineField({name: 'colour', type: 'string', group: 'basics'}),
    defineField({name: 'completedOn', type: 'date', group: 'basics', validation: (r) => r.required()}),
    defineField({name: 'squareFeet', type: 'number', group: 'basics', validation: (r) => r.min(50).max(20000)}),
    defineField({name: 'durationDays', type: 'number', group: 'basics', validation: (r) => r.min(1).max(120)}),
    defineField({name: 'existingConditions', title: 'What the roof was like before', type: 'text', rows: 3, group: 'story'}),
    defineField({name: 'challenges', title: 'What was hard about it', type: 'text', rows: 4, group: 'story', validation: (r) => r.required().min(40)}),
    defineField({name: 'solution', title: 'The options you weighed, what you installed and why', description: 'Name the options you considered, say which one you recommended and why, then what was installed.', type: 'text', rows: 5, group: 'story', validation: (r) => r.required().min(40)}),
    defineField({name: 'outcome', title: 'The result', type: 'text', rows: 3, group: 'story'}),
    defineField({
      name: 'photos',
      type: 'array',
      group: 'media',
      validation: (r) => r.required().min(1),
      of: [
        defineArrayMember({
          type: 'image',
          options: {hotspot: true},
          fields: [
            defineField({name: 'alt', title: 'Alt text (describe what is visible)', type: 'string', validation: (r) => r.required().min(12).max(160)}),
            defineField({name: 'caption', type: 'string'}),
            defineField({name: 'stage', title: 'When was it taken', type: 'string', options: {list: ['before', 'during', 'after'], layout: 'radio'}}),
          ],
        }),
      ],
    }),
    defineField({
      name: 'videos',
      type: 'array',
      group: 'media',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'projectVideo',
          fields: [
            defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
            defineField({name: 'file', type: 'file', options: {accept: 'video/mp4'}}),
            defineField({name: 'poster', type: 'image'}),
            defineField({name: 'durationSeconds', type: 'number'}),
          ],
        }),
      ],
    }),
    defineField({
      name: 'photoRelease',
      title: 'The homeowner agreed in writing to photographs of the home being published',
      description: 'Required to publish. Using a likeness to promote services needs consent (BC Privacy Act s.3).',
      type: 'boolean',
      initialValue: false,
      group: 'media',
      validation: (r) => r.custom((v, ctx) => (String(ctx.document?._id ?? '').startsWith('drafts.') || v === true ? true : 'Tick the photo release before publishing')),
    }),
    defineField({
      name: 'review',
      type: 'object',
      group: 'review',
      validation: (r) => r.custom((v: any) => (v?.quote && v.consent !== true ? 'A review can only be saved with the customer’s written consent ticked' : true)),
      fields: [
        defineField({name: 'quote', type: 'text', rows: 3}),
        defineField({name: 'author', title: 'First name and initial only', type: 'string'}),
        defineField({name: 'consent', title: 'The customer agreed in writing to show this', type: 'boolean', initialValue: false}),
      ],
    }),
    defineField({
      name: 'aiRun',
      title: 'AI draft that produced this (audit)',
      type: 'reference',
      to: [{type: 'aiRun'}],
      readOnly: true,
      group: 'basics',
      weak: true,
    }),
  ],
  preview: {select: {title: 'title', subtitle: 'roofType', media: 'photos.0'}},
})
