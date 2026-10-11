import {defineField, defineType} from 'sanity'

export const business = defineType({
  name: 'business',
  title: 'Business',
  type: 'document',
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'legalName', type: 'string'}),
    defineField({
      name: 'telephone',
      title: 'Main phone number (the real one)',
      description:
        'This number is printed in the page source and in the structured data for local SEO. Call tracking may swap what a visitor sees, never this value.',
      type: 'string',
      validation: (r) => r.required().regex(/^\+\d[\d-]{8,}$/, {name: 'E.164-style number, e.g. +1-604-555-0142'}),
    }),
    defineField({name: 'email', type: 'string'}),
    defineField({name: 'streetAddress', type: 'string'}),
    defineField({name: 'city', type: 'string'}),
    defineField({name: 'region', type: 'string'}),
    defineField({name: 'postalCode', type: 'string'}),
    defineField({name: 'country', type: 'string'}),
    defineField({name: 'url', type: 'url'}),
    defineField({name: 'sameAs', title: 'Profiles (Google Business Profile, social)', type: 'array', of: [{type: 'url'}]}),
    defineField({name: 'areaServed', type: 'array', of: [{type: 'string'}]}),
    defineField({name: 'credentials', title: 'Licence, insurance, WorkSafeBC, warranty and certifications (one per line, shown on the home page)', type: 'array', of: [{type: 'string'}]}),
  ],
})
