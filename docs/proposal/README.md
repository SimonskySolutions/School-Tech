# Proposal diagrams

The architecture diagram from the Pitagor One proposal (28 October 2026), in English and Bulgarian:

- [pitagor-one-architecture-en.png](pitagor-one-architecture-en.png)
- [pitagor-one-architecture-bg.png](pitagor-one-architecture-bg.png)

They show the stack the proposal planned: Django and Wagtail behind Nginx, Celery for background work and MinIO for files. The proposal also named Next.js with Payload CMS as an alternative with the same modules, and that is what was built: Next.js and Payload for the websites and the portal, a NestJS API and worker, Caddy as the gateway and Garage for files. For the platform as it is, see [architecture.md](../architecture.md) and the [decisions](../decisions/README.md).
