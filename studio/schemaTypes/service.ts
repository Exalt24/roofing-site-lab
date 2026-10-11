import {defineField, defineType} from 'sanity'

export const service = defineType({
  name: 'service',
  title: 'Service',
  type: 'document',
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'name'}, validation: (r) => r.required()}),
    defineField({name: 'summary', type: 'text', rows: 2, validation: (r) => r.required().max(200)}),
    defineField({name: 'body', type: 'text', rows: 6}),
  ],
})
