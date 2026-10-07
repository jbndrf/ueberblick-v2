/** A parcel with computed properties, declared in reverse dependency order (size_class reads area) on purpose. */
interface Prop {
  type: string;
  computed?: string;
  default?: unknown;
  options?: Record<string, string>;
  to?: string;
  geometry_type?: string;
}
interface Fixture {
  schema: string;
  template: { key: string; version: string };
  roles: Record<string, { label: string }>;
  types: Record<
    string,
    {
      label: string;
      permissions: Record<string, unknown>;
      properties: Record<string, Prop>;
      relations?: Record<string, Record<string, unknown>>;
    }
  >;
  tasks: Record<
    string,
    {
      label: string;
      on: string;
      creates?: string;
      form: Record<string, object>;
      steps?: unknown[];
      then?: unknown[];
    }
  >;
}

export const computedFile = (): Fixture => ({
  schema: 'ueberblick/1',
  template: { key: 'computed', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    owner: {
      label: 'Owner',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { width: { type: 'integer' } },
    },
    parcel: {
      label: 'Parcel',
      permissions: {
        see: '$all',
        create: ['maker'],
        write: { width: ['maker'], height: ['maker'], label: ['maker'], stamp: ['maker'] },
      },
      properties: {
        label: { type: 'text' },
        stamp: { type: 'datetime' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        size_class: {
          type: 'select',
          options: { small: 'Small', large: 'Large' },
          computed: "self.area > 100 ? 'large' : 'small'",
        },
        area: { type: 'integer', computed: 'self.width * self.height' },
        owner: { type: 'reference', to: 'owner' },
        geo: { type: 'geometry', geometry_type: 'polygon' },
      },
      relations: { neighbours: { to: 'parcel', derive: 'intersects(self.geo, other.geo)' } },
    },
  },
  tasks: {
    create: { label: 'Create', on: '$map', creates: 'parcel', form: { width: {}, height: {}, label: {} } },
    edit: { label: 'Edit', on: 'parcel', form: { width: {}, height: {}, label: {} } },
  },
});
