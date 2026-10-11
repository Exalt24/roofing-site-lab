import {defineField, defineType} from 'sanity'

export const neighbourhood = defineType({
  name: 'neighbourhood',
  title: 'Neighbourhood',
  type: 'document',
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'name'}, validation: (r) => r.required()}),
    defineField({name: 'city', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'facts',
      title: 'What is genuinely local here',
      description:
        'Housing stock, weather exposure, access and permit notes, written by a person who has worked here. A neighbourhood page is only published when it has at least two completed projects AND this text has at least 25 words.',
      type: 'text',
      rows: 5,
    }),
  ],
})
