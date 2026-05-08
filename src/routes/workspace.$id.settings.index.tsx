import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/workspace/$id/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workspace/$id/settings/$tab',
      params: { id: params.id, tab: 'general' },
    })
  },
})
