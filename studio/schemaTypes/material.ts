import {defineField, defineType} from 'sanity'

export const material = defineType({
  name: 'material',
  title: 'Material',
  type: 'document',
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'name'}, validation: (r) => r.required()}),
    defineField({name: 'summary', type: 'text', rows: 2, validation: (r) => r.required().max(200)}),
  ],
})
