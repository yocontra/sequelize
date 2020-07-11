import * as DataTypes from './data-types';
import { formatNamedParameters, format as sqlFormat } from './sql-string';
import { mergeWith, isPlainObject, isFunction, forOwn, cloneDeepWith, get, forIn, isObject, isEmpty } from 'lodash';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseIsNative: (val: unknown) => boolean = require('lodash/_baseIsNative');
import { v1 as uuidv1, v4 as uuidv4 } from 'uuid';
import { Op } from './operators';

const operatorsSet = new Set(Object.values(Op));

import * as Inflection from 'inflection';

export { classToInvokable } from './utils/class-to-invokable';
export { joinSQLFragments } from './utils/join-sql-fragments';
export { formatNamedParameters };

export let inflection = Inflection;
export function useInflection(_inflection: typeof Inflection): void {
  inflection = _inflection;
}

export function underscoredIf(str: string, condition: boolean): string {
  if (condition) {
    return underscore(str);
  }

  return str;
}

export function isPrimitive(val: unknown): val is string | number | boolean {
  const type = typeof val;
  return type === 'string' || type === 'number' || type === 'boolean';
}

// Same concept as _.merge, but don't overwrite properties that have already been assigned
export function mergeDefaults<T>(a: T, b: T): T {
  return mergeWith(a, b, (objectValue, sourceValue) => {
    // If it's an object, let _ handle it this time, we will be called again for each property
    if (!isPlainObject(objectValue) && objectValue !== undefined) {
      // _.isNative includes a check for core-js and throws an error if present.
      // Depending on _baseIsNative bypasses the core-js check.
      if (isFunction(objectValue) && baseIsNative(objectValue)) {
        return sourceValue || objectValue;
      }
      return objectValue;
    }
  });
}

// An alternative to _.merge, which doesn't clone its arguments
// Cloning is a bad idea because options arguments may contain references to sequelize
// models - which again reference database libs which don't like to be cloned (in particular pg-native)
export function merge(...args: object[]): object {
  const result = {};

  for (const obj of args) {
    forOwn(obj, (value, key) => {
      if (value !== undefined) {
        if (!result[key]) {
          result[key] = value;
        } else if (isPlainObject(value) && isPlainObject(result[key])) {
          result[key] = merge(result[key], value);
        } else if (Array.isArray(value) && Array.isArray(result[key])) {
          result[key] = value.concat(result[key]);
        } else {
          result[key] = value;
        }
      }
    });
  }

  return result;
}

/**
 * Takes the substring from 0 to `index` of `str` then concats `add` and `str[index+count:]`
 */
export function spliceStr(str: string, index: number, count: number, add: string): string {
  return str.slice(0, index) + add + str.slice(index + count);
}

export function camelize(str: string): string {
  return str.trim().replace(/[-_\s]+(.)?/g, (match, c) => c.toUpperCase());
}

export function underscore(str: string): string {
  return inflection.underscore(str);
}

export function singularize(str: string): string {
  return inflection.singularize(str);
}

export function pluralize(str: string): string {
  return inflection.pluralize(str);
}

export function format(arr: string[], dialect: string): string {
  // Make a clone of the array because format modifies the passed args
  return sqlFormat(arr[0], arr.slice(1), dialect);
}

export function cloneDeep<T extends object>(obj: T, onlyPlain?: boolean): T {
  obj = obj || {};
  return cloneDeepWith(obj, elem => {
    // Do not try to customize cloning of arrays or POJOs
    if (Array.isArray(elem) || isPlainObject(elem)) {
      return undefined;
    }

    // If we specified to clone only plain objects & arrays, we ignore everyhing else
    // In any case, don't clone stuff that's an object, but not a plain one - fx example sequelize models and instances
    if (onlyPlain || typeof elem === 'object') {
      return elem;
    }

    // Preserve special data-types like `fn` across clones. _.get() is used for checking up the prototype chain
    if (elem && typeof elem.clone === 'function') {
      return elem.clone();
    }
  });
}

/* Expand and normalize finder options */
export function mapFinderOptions(options, Model) {
  if (options.attributes && Array.isArray(options.attributes)) {
    options.attributes = Model._injectDependentVirtualAttributes(options.attributes);
    options.attributes = options.attributes.filter(v => !Model._virtualAttributes.has(v));
  }

  mapOptionFieldNames(options, Model);

  return options;
}

/* Used to map field names in attributes and where conditions */
export function mapOptionFieldNames(options, Model) {
  if (Array.isArray(options.attributes)) {
    options.attributes = options.attributes.map(attr => {
      // Object lookups will force any variable to strings, we don't want that for special objects etc
      if (typeof attr !== 'string') return attr;
      // Map attributes to aliased syntax attributes
      if (Model.rawAttributes[attr] && attr !== Model.rawAttributes[attr].field) {
        return [Model.rawAttributes[attr].field, attr];
      }
      return attr;
    });
  }

  if (options.where && isPlainObject(options.where)) {
    options.where = mapWhereFieldNames(options.where, Model);
  }

  return options;
}

export function mapWhereFieldNames(attributes, Model) {
  if (attributes) {
    getComplexKeys(attributes).forEach(attribute => {
      const rawAttribute = Model.rawAttributes[attribute];

      if (rawAttribute && rawAttribute.field !== rawAttribute.fieldName) {
        attributes[rawAttribute.field] = attributes[attribute];
        delete attributes[attribute];
      }

      if (
        isPlainObject(attributes[attribute]) &&
        !(
          rawAttribute &&
          (rawAttribute.type instanceof DataTypes.HSTORE || rawAttribute.type instanceof DataTypes.JSON)
        )
      ) {
        // Prevent renaming of HSTORE & JSON fields
        attributes[attribute] = mapOptionFieldNames(
          {
            where: attributes[attribute]
          },
          Model
        ).where;
      }

      if (Array.isArray(attributes[attribute])) {
        attributes[attribute].forEach((where, index) => {
          if (isPlainObject(where)) {
            attributes[attribute][index] = mapWhereFieldNames(where, Model);
          }
        });
      }
    });
  }

  return attributes;
}

/* Used to map field names in values */
export function mapValueFieldNames(dataValues, fields: string[], Model): object {
  const values = {};

  for (const attr of fields) {
    if (dataValues[attr] !== undefined && !Model._virtualAttributes.has(attr)) {
      // Field name mapping
      if (Model.rawAttributes[attr] && Model.rawAttributes[attr].field && Model.rawAttributes[attr].field !== attr) {
        values[Model.rawAttributes[attr].field] = dataValues[attr];
      } else {
        values[attr] = dataValues[attr];
      }
    }
  }

  return values;
}

export function isColString(value: string): boolean {
  return typeof value === 'string' && value[0] === '$' && value[value.length - 1] === '$';
}

export function canTreatArrayAsAnd(arr: unknown[]): boolean {
  return arr.some(arg => isPlainObject(arg) || arg instanceof Where);
}

/**
 * Creates a deterministic combined table name.
 */
export function combineTableNames(tableName1: string, tableName2: string): string {
  return tableName1.toLowerCase() < tableName2.toLowerCase() ? tableName1 + tableName2 : tableName2 + tableName1;
}

export function toDefaultValue(value: unknown, dialect: string): unknown {
  if (typeof value === 'function') {
    const tmp = value();
    if (tmp instanceof DataTypes.ABSTRACT) {
      return tmp.toSql();
    }
    return tmp;
  }
  if (value instanceof DataTypes.UUIDV1) {
    return uuidv1();
  }
  if (value instanceof DataTypes.UUIDV4) {
    return uuidv4();
  }
  if (value instanceof DataTypes.NOW) {
    return now(dialect);
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (isPlainObject(value)) {
    return { ...(value as object) };
  }
  return value;
}

/**
 * Determine if the default value provided exists and can be described
 * in a db schema using the DEFAULT directive.
 *
 * @private
 */
export function defaultValueSchemable(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  // TODO this will be schemable when all supported db
  // have been normalized for this case
  if (value instanceof DataTypes.NOW) {
    return false;
  }

  if (value instanceof DataTypes.UUIDV1 || value instanceof DataTypes.UUIDV4) {
    return false;
  }

  return typeof value !== 'function';
}

export function removeNullValuesFromHash(hash, omitNull, options?: { allowNull?: string[] }): object {
  let result = hash;

  options = {
    allowNull: [],
    ...options
  };

  if (omitNull) {
    const _hash: {
      [key: string]: unknown;
    } = {};

    forIn(hash, (val, key) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (options!.allowNull!.includes(key) || key.endsWith('Id') || (val !== null && val !== undefined)) {
        _hash[key] = val;
      }
    });

    result = _hash;
  }

  return result;
}

const dialects = new Set(['mariadb', 'mysql', 'postgres', 'sqlite', 'mssql']);

export function now(dialect: string): Date {
  const d = new Date();
  if (!dialects.has(dialect)) {
    d.setMilliseconds(0);
  }
  return d;
}

// Note: Use the `quoteIdentifier()` and `escape()` methods on the
// `QueryInterface` instead for more portable code.

export const TICK_CHAR = '`';

export function addTicks(s: string, tickChar: string = TICK_CHAR): string {
  return tickChar + removeTicks(s, tickChar) + tickChar;
}

export function removeTicks(s: string, tickChar: string = TICK_CHAR): string {
  return s.replace(new RegExp(tickChar, 'g'), '');
}

/**
 * Receives a tree-like object and returns a plain object which depth is 1.
 *
 * - Input:
 *
 *  {
 *    name: 'John',
 *    address: {
 *      street: 'Fake St. 123',
 *      coordinates: {
 *        longitude: 55.6779627,
 *        latitude: 12.5964313
 *      }
 *    }
 *  }
 *
 * - Output:
 *
 *  {
 *    name: 'John',
 *    address.street: 'Fake St. 123',
 *    address.coordinates.latitude: 55.6779627,
 *    address.coordinates.longitude: 12.5964313
 *  }
 *
 * @param {object} value an Object
 * @returns {object} a flattened object
 * @private
 */
export function flattenObjectDeep(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const flattenedObj = {};

  function flattenObject(obj: object, subPath?: string) {
    Object.keys(obj).forEach(key => {
      const pathToProperty = subPath ? `${subPath}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        flattenObject(obj[key], pathToProperty);
      } else {
        flattenedObj[pathToProperty] = get(obj, key);
      }
    });
    return flattenedObj;
  }

  return flattenObject(value, undefined);
}

/**
 * Utility functions for representing SQL functions, and columns that should be escaped.
 * Please do not use these functions directly, use Sequelize.fn and Sequelize.col instead.
 *
 * @private
 */
abstract class SequelizeMethod {}

export class Fn extends SequelizeMethod {
  constructor(public readonly fn: string, public readonly args: unknown[]) {
    super();
  }

  clone(): Fn {
    return new Fn(this.fn, this.args);
  }
}

export class Col extends SequelizeMethod {
  constructor(public readonly col: string) {
    super();
  }
}

export class Cast extends SequelizeMethod {
  public readonly type: string;
  constructor(public readonly val: unknown, type: string, public readonly json = false) {
    super();
    this.type = (type || '').trim();
  }
}

export class Literal extends SequelizeMethod {
  constructor(private val: string) {
    super();
  }
}

export class Json extends SequelizeMethod {
  public readonly conditions?: object;
  public readonly path?: string;
  public readonly value?: unknown;
  constructor(conditionsOrPath: string | object, value: unknown) {
    super();
    if (isObject(conditionsOrPath)) {
      this.conditions = conditionsOrPath;
    } else {
      this.path = conditionsOrPath;
      if (value) {
        this.value = value;
      }
    }
  }
}

export class Where extends SequelizeMethod {
  public readonly comparator: string;
  public readonly logic: string;

  constructor(public readonly attribute: string, comparator: string, logic: string) {
    super();
    if (logic === undefined) {
      logic = comparator;
      comparator = '=';
    }

    this.comparator = comparator;
    this.logic = logic;
  }
}

//Collection of helper methods to make it easier to work with symbol operators

/**
 * @private
 */
export function getOperators(obj: object): symbol[] {
  return Object.getOwnPropertySymbols(obj).filter(s => operatorsSet.has(s));
}

/**
 * @private
 */
export function getComplexKeys(obj: object): Array<symbol | string> {
  return (getOperators(obj) as Array<string | symbol>).concat(Object.keys(obj));
}

/**
 * getComplexSize
 *
 * @param  {object|Array} obj
 * @returns {number}      Length of object properties including operators if obj is array returns its length
 * @private
 */
export function getComplexSize(obj: object | unknown[]): number {
  return Array.isArray(obj) ? obj.length : getComplexKeys(obj).length;
}

/**
 * Returns true if a where clause is empty, even with Symbols
 *
 * @param  {object} obj
 * @returns {boolean}
 * @private
 */
export function isWhereEmpty(obj: object): boolean {
  return !!obj && isEmpty(obj) && getOperators(obj).length === 0;
}

/**
 * Returns ENUM name by joining table and column name
 * @private
 */
export function generateEnumName(tableName: string, columnName: string): string {
  return `enum_${tableName}_${columnName}`;
}

/**
 * Returns an new Object which keys are camelized
 * @private
 */
export function camelizeObjectKeys(obj: { [key: string]: string }): { [key: string]: string } {
  const newObj: { [key: string]: string } = {};
  Object.keys(obj).forEach(key => {
    newObj[camelize(key)] = obj[key];
  });
  return newObj;
}

interface NameIndex {
  fields: Array<string | { name: string; attribute: string }>;
  name?: string;
}

/**
 * @private
 */
export function nameIndex(index: NameIndex, tableName: string | { tableName: string }): NameIndex {
  if (typeof tableName === 'object' && tableName.tableName) tableName = tableName.tableName;

  if (!Object.prototype.hasOwnProperty.call(index, 'name')) {
    const fields = index.fields.map(field => (typeof field === 'string' ? field : field.name || field.attribute));
    index.name = underscore(`${tableName}_${fields.join('_')}`);
  }

  return index;
}

/**
 * Checks if 2 arrays intersect.
 * @private
 */
export function intersects(arr1: unknown[], arr2: unknown[]): boolean {
  return arr1.some(v => arr2.includes(v));
}
