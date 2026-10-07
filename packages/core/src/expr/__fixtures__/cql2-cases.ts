/**
 * Corpus for fromCql2 (WP-109). Cases follow the examples of OGC CQL2 (21-065r2) and the
 * OGC API Features Part 3 examples. Each case gives the text and the JSON encoding of one
 * filter and the expected result as rule-language source (parsed with `parse`).
 */
export interface Cql2Case {
  readonly name: string;
  readonly text: string;
  readonly json: unknown;
  readonly cel: string;
}

const P = (property: string) => ({ property });
const op = (name: string, ...args: unknown[]) => ({ op: name, args });
const pt = (...c: number[]) => ({ type: 'Point', coordinates: c });
const sq = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};
const SQ_CEL = `{'type':'Polygon','coordinates':[[[0.0,0.0],[10.0,0.0],[10.0,10.0],[0.0,10.0],[0.0,0.0]]]}`;
const SQ_WKT = 'POLYGON((0 0,10 0,10 10,0 10,0 0))';
const PT12 = "{'type':'Point','coordinates':[1.0,2.0]}";

export const CQL2_CASES: readonly Cql2Case[] = [
  // comparison
  {
    name: 'eq string',
    text: "city='Toronto'",
    json: op('=', P('city'), 'Toronto'),
    cel: "self.city == 'Toronto'",
  },
  { name: 'eq int', text: 'floors = 5', json: op('=', P('floors'), 5), cel: 'self.floors == 5' },
  { name: 'neq', text: 'floors <> 5', json: op('<>', P('floors'), 5), cel: 'self.floors != 5' },
  { name: 'lt', text: 'floors < 5', json: op('<', P('floors'), 5), cel: 'self.floors < 5' },
  { name: 'le', text: 'floors <= 5', json: op('<=', P('floors'), 5), cel: 'self.floors <= 5' },
  { name: 'gt', text: 'floors > 5', json: op('>', P('floors'), 5), cel: 'self.floors > 5' },
  { name: 'ge', text: 'floors >= 5', json: op('>=', P('floors'), 5), cel: 'self.floors >= 5' },
  { name: 'double', text: 'height > 12.5', json: op('>', P('height'), 12.5), cel: 'self.height > 12.5' },
  {
    name: 'exponent',
    text: 'height < 1.5005e3',
    json: op('<', P('height'), 1500.5),
    cel: 'self.height < 1500.5',
  },
  { name: 'negative', text: 'temp < -5', json: op('<', P('temp'), -5), cel: 'self.temp < -5' },
  {
    name: 'escaped quote',
    text: "name = 'it''s'",
    json: op('=', P('name'), "it's"),
    cel: `self.name == "it's"`,
  },
  {
    name: 'quoted property',
    text: '"tree height" > 3',
    json: op('>', P('tree height'), 3),
    cel: 'self["tree height"] > 3',
  },
  { name: 'bool literal', text: 'open = true', json: op('=', P('open'), true), cel: 'self.open == true' },
  { name: 'bool upper', text: 'open = FALSE', json: op('=', P('open'), false), cel: 'self.open == false' },
  { name: 'literal left', text: '5 < floors', json: op('<', 5, P('floors')), cel: '5 < self.floors' },
  { name: 'two properties', text: 'a = b', json: op('=', P('a'), P('b')), cel: 'self.a == self.b' },
  // logical
  {
    name: 'and',
    text: "floors>5 AND material='brick'",
    json: op('and', op('>', P('floors'), 5), op('=', P('material'), 'brick')),
    cel: "self.floors > 5 && self.material == 'brick'",
  },
  {
    name: 'or',
    text: 'swimming_pool=true OR floors>5',
    json: op('or', op('=', P('swimming_pool'), true), op('>', P('floors'), 5)),
    cel: 'self.swimming_pool == true || self.floors > 5',
  },
  {
    name: 'not',
    text: 'NOT (floors > 5)',
    json: op('not', op('>', P('floors'), 5)),
    cel: '!(self.floors > 5)',
  },
  {
    name: 'lowercase keywords',
    text: 'a = 1 and not b = 2 or c = 3',
    json: op('or', op('and', op('=', P('a'), 1), op('not', op('=', P('b'), 2))), op('=', P('c'), 3)),
    cel: '(self.a == 1 && !(self.b == 2)) || self.c == 3',
  },
  {
    name: 'three and',
    text: 'a=1 AND b=2 AND c=3',
    json: op('and', op('and', op('=', P('a'), 1), op('=', P('b'), 2)), op('=', P('c'), 3)),
    cel: 'self.a == 1 && self.b == 2 && self.c == 3',
  },
  {
    name: 'nary and json',
    text: 'a=1 AND b=2 AND c=3',
    json: op('and', op('=', P('a'), 1), op('=', P('b'), 2), op('=', P('c'), 3)),
    cel: 'self.a == 1 && self.b == 2 && self.c == 3',
  },
  {
    name: 'precedence',
    text: 'a=1 OR b=2 AND c=3',
    json: op('or', op('=', P('a'), 1), op('and', op('=', P('b'), 2), op('=', P('c'), 3))),
    cel: 'self.a == 1 || (self.b == 2 && self.c == 3)',
  },
  {
    name: 'parens',
    text: '(a=1 OR b=2) AND c=3',
    json: op('and', op('or', op('=', P('a'), 1), op('=', P('b'), 2)), op('=', P('c'), 3)),
    cel: '(self.a == 1 || self.b == 2) && self.c == 3',
  },
  {
    name: 'double not',
    text: 'NOT NOT a = 1',
    json: op('not', op('not', op('=', P('a'), 1))),
    cel: '!(!(self.a == 1))',
  },
  { name: 'true alone', text: 'TRUE', json: true, cel: 'true' },
  // in, null, between
  {
    name: 'in',
    text: "city IN ('Toronto','Frankfurt','Tokyo')",
    json: op('in', P('city'), ['Toronto', 'Frankfurt', 'Tokyo']),
    cel: "self.city in ['Toronto','Frankfurt','Tokyo']",
  },
  {
    name: 'in numbers',
    text: 'floors IN (1, 2, 3)',
    json: op('in', P('floors'), [1, 2, 3]),
    cel: 'self.floors in [1,2,3]',
  },
  {
    name: 'not in',
    text: 'floors NOT IN (1, 2)',
    json: op('not', op('in', P('floors'), [1, 2])),
    cel: '!(self.floors in [1,2])',
  },
  { name: 'is null', text: 'owner IS NULL', json: op('isNull', P('owner')), cel: 'self.owner == null' },
  {
    name: 'is not null',
    text: 'owner IS NOT NULL',
    json: op('not', op('isNull', P('owner'))),
    cel: '!(self.owner == null)',
  },
  {
    name: 'is null lower',
    text: 'owner is not null',
    json: op('not', op('isNull', P('owner'))),
    cel: '!(self.owner == null)',
  },
  {
    name: 'between',
    text: 'floors BETWEEN 4 AND 8',
    json: op('between', P('floors'), 4, 8),
    cel: 'self.floors >= 4 && self.floors <= 8',
  },
  {
    name: 'not between',
    text: 'floors NOT BETWEEN 4 AND 8',
    json: op('not', op('between', P('floors'), 4, 8)),
    cel: '!(self.floors >= 4 && self.floors <= 8)',
  },
  {
    name: 'between and and',
    text: 'floors BETWEEN 4 AND 8 AND open = true',
    json: op('and', op('between', P('floors'), 4, 8), op('=', P('open'), true)),
    cel: '(self.floors >= 4 && self.floors <= 8) && self.open == true',
  },
  // like
  {
    name: 'like prefix',
    text: "name LIKE 'Ma%'",
    json: op('like', P('name'), 'Ma%'),
    cel: "self.name.startsWith('Ma')",
  },
  {
    name: 'like suffix',
    text: "name LIKE '%burg'",
    json: op('like', P('name'), '%burg'),
    cel: "self.name.endsWith('burg')",
  },
  {
    name: 'like infix',
    text: "name LIKE '%ain%'",
    json: op('like', P('name'), '%ain%'),
    cel: "self.name.contains('ain')",
  },
  {
    name: 'like exact',
    text: "name LIKE 'Main'",
    json: op('like', P('name'), 'Main'),
    cel: "self.name == 'Main'",
  },
  {
    name: 'not like',
    text: "name NOT LIKE 'Ma%'",
    json: op('not', op('like', P('name'), 'Ma%')),
    cel: "!(self.name.startsWith('Ma'))",
  },
  {
    name: 'like escaped percent',
    text: "name LIKE '100\\%%'",
    json: op('like', P('name'), '100\\%%'),
    cel: "self.name.startsWith('100%')",
  },
  {
    name: 'like casei',
    text: "CASEI(name) LIKE CASEI('Ma%')",
    json: op('like', op('casei', P('name')), op('casei', 'Ma%')),
    cel: "self.name.lower().startsWith('ma')",
  },
  {
    name: 'casei eq',
    text: "CASEI(name) = CASEI('Main')",
    json: op('=', op('casei', P('name')), op('casei', 'Main')),
    cel: "self.name.lower() == 'main'",
  },
  // arithmetic and dates
  {
    name: 'add',
    text: 'floors + 1 > 5',
    json: op('>', op('+', P('floors'), 1), 5),
    cel: 'self.floors + 1 > 5',
  },
  {
    name: 'mul precedence',
    text: 'a + 2 * 3 = 9',
    json: op('=', op('+', P('a'), op('*', 2, 3)), 9),
    cel: 'self.a + (2 * 3) == 9',
  },
  {
    name: 'sub div',
    text: '(a - 1) / 2 < 3',
    json: op('<', op('/', op('-', P('a'), 1), 2), 3),
    cel: '(self.a - 1) / 2 < 3',
  },
  { name: 'modulo', text: 'a % 2 = 0', json: op('=', op('%', P('a'), 2), 0), cel: 'self.a % 2 == 0' },
  { name: 'unary minus', text: '-a > 3', json: op('>', op('-', P('a')), 3), cel: '-self.a > 3' },
  {
    name: 'date',
    text: "built > DATE('2012-06-05')",
    json: op('>', P('built'), { date: '2012-06-05' }),
    cel: "self.built > date('2012-06-05')",
  },
  {
    name: 'timestamp',
    text: "updated <= TIMESTAMP('2012-06-05T00:00:00Z')",
    json: op('<=', P('updated'), { timestamp: '2012-06-05T00:00:00Z' }),
    cel: "self.updated <= date('2012-06-05T00:00:00Z')",
  },
];

export { P, op, pt, sq, SQ_CEL, SQ_WKT, PT12 };
