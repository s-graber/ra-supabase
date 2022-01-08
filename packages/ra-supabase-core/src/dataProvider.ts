import { DataProvider, AuthProvider } from 'ra-core';
import { SupabaseClient } from '@supabase/supabase-js';
import jwt_decode from 'jwt-decode';

export const supabaseDataProvider = (
    client: SupabaseClient,
    resources: ResourcesOptions,
    authProvider: AuthProvider,
    logging: boolean
): DataProvider => ({
    getList: async (resource, params) => {
        return getList({ client, resources, resource, params, logging });
    },
    getOne: async (resource, { id }) => {
        const resourceOptions = resources[resource];
        const fields = Array.isArray(resourceOptions)
            ? resourceOptions
            : resourceOptions.fields;

        const { data, error } = await client
            .from(resource)
            .select(fields.join(', '))
            .match({ id })
            .single();

        if (error) {
            throw error;
        }
        return { data };
    },
    getMany: async (resource, { ids }) => {
        const resourceOptions = resources[resource];
        const fields = Array.isArray(resourceOptions)
            ? resourceOptions
            : resourceOptions.fields;

        const { data, error } = await client
            .from(resource)
            .select(fields.join(', '))
            .in('id', ids);

        if (error) {
            throw error;
        }
        return { data: data ?? [] };
    },
    getManyReference: async (resource, originalParams) => {
        const { target, id } = originalParams;
        const params = {
            ...originalParams,
            filter: { ...originalParams.filter, [target]: id },
        };
        // console.log('getManyReference', params.filter);
        return getList({ client, resources, resource, params, logging });
    },
    create: async (resource, { data }) => {
        const decoded: { email: string } = jwt_decode(
            await authProvider.getJWTToken()
        );
        if (decoded && decoded.email) {
            data.createdby = decoded.email;
        }
        data.createdate = new Date();
        const { data: record, error } = await client
            .from(resource)
            .insert(data)
            .single();

        if (error) {
            throw error;
        }
        return { data: record };
    },
    update: async (resource, { id, data }) => {
        const decoded: { email: string } = jwt_decode(
            await authProvider.getJWTToken()
        );
        if (decoded && decoded.email) {
            data.createdby = decoded.email;
        }
        const { data: record, error } = await client
            .from(resource)
            .update(data)
            .match({ id })
            .single();

        if (error) {
            throw error;
        }
        return { data: record };
    },
    updateMany: async (resource, { ids, data }) => {
        const decoded: { email: string } = jwt_decode(
            await authProvider.getJWTToken()
        );
        if (decoded && decoded.email) {
            data.createdby = decoded.email;
        }
        const { data: records, error } = await client
            .from(resource)
            .update(data)
            .in('id', ids);

        if (error) {
            throw error;
        }
        return { data: records?.map(record => record.id) };
    },
    delete: async (resource, { id }) => {
        const { data: record, error } = await client
            .from(resource)
            .delete()
            .match({ id })
            .single();

        if (error) {
            throw error;
        }
        return { data: record };
    },
    deleteMany: async (resource, { ids }) => {
        const { data: records, error } = await client
            .from(resource)
            .delete()
            .in('id', ids);

        if (error) {
            throw error;
        }
        return { data: records?.map(record => record.id) };
    },
});

type ResourceOptionsWithFullTextSearch = {
    fields: string[];
    fullTextSearchFields: string[];
};
export type ResourceOptions = string[] | ResourceOptionsWithFullTextSearch;
export type ResourcesOptions = Record<string, ResourceOptions>;

export type PostgrestFilterBuilder = (
    arg0: PostgrestFilterBuilder
) => PostgrestFilterBuilder;

const getList = async ({ client, resources, resource, params, logging }) => {
    const {
        pagination,
        sort,
        filter: { q, ...filter },
    } = params;

    const resourceOptions = resources[resource];
    const fields = Array.isArray(resourceOptions)
        ? resourceOptions
        : resourceOptions.fields;

    const rangeFrom = (pagination.page - 1) * pagination.perPage;
    const rangeTo = rangeFrom + pagination.perPage - 1;

    const filterSafe = filter || {};

    const customFilterQuery = filterSafe.customFilterQuery;
    delete filterSafe.customFilterQuery;
    const matchFilter = { ...filter };

    const cleansedFields = [];
    for (var k of fields) {
        if (
            k.endsWith('_gte') ||
            k.endsWith('_lte') ||
            k.endsWith('_neq') ||
            k.endsWith('_is_not') ||
            k.endsWith('_is')
        ) {
            cleansedFields.push(
                k
                    .replace('_gte', '')
                    .replace('_lte', '')
                    .replace('_is_not', '')
                    .replace('_neq', '')
                    .replace('_is', '')
            );
        } else {
            cleansedFields.push(k);
        }
    }
    const cleansedFieldsWithoutDuplicate = cleansedFields.filter(
        (item, pos, self) => self.indexOf(item) === pos
    );

    for (var filterKey in filter) {
        if (
            filterKey.endsWith('_gte') ||
            filterKey.endsWith('_lte') ||
            filterKey.endsWith('_is_not') ||
            filterKey.endsWith('_is') ||
            filterKey.endsWith('_neq')
        ) {
            delete filter[filterKey];
        }
    }
    let query = client
        .from(resource)
        .select(cleansedFieldsWithoutDuplicate.join(', '), { count: 'exact' })
        .order(sort.field, { ascending: sort.order === 'ASC' })
        .match(filter)
        .range(rangeFrom, rangeTo);

    for (var key in matchFilter) {
        if (key.endsWith('_gte')) {
            // console.info('matchFilter found ≥', key, matchFilter[key]);
            query = query.gte(key.replace('_gte', ''), matchFilter[key]);
        }
        if (key.endsWith('_lte')) {
            // console.info('matchFilter found ≤', key, matchFilter[key]);
            query = query.lte(key.replace('_lte', ''), matchFilter[key]);
        }
        if (key.endsWith('_neq')) {
            // console.info('matchFilter found !=', key, matchFilter[key]);
            query = query.neq(key.replace('_neq', ''), matchFilter[key]);
        }
        if (key.endsWith('_is_not')) {
            // console.info('matchFilter found is_not', key, matchFilter[key]);
            query = query.not(
                key.replace('_is_not', ''),
                'is',
                matchFilter[key]
            );
        } else if (key.endsWith('_is')) {
            // console.info('matchFilter found is', key, matchFilter[key]);
            query = query.is(key.replace('_is', ''), matchFilter[key]);
        }
    }

    if (customFilterQuery) {
        // console.info('customFilterQuery', customFilterQuery);
        query = query.or(`${customFilterQuery}`);
    }

    if (q) {
        const fullTextSearchFields = Array.isArray(resourceOptions)
            ? resourceOptions
            : resourceOptions.fullTextSearchFields;

        query = query.or(
            fullTextSearchFields.map(field => `${field}.ilike.%${q}%`).join(',')
        );
    }

    const { data, error, count } = await query;

    if (logging) {
        console.log('query', {
            cleansedFieldsWithoutDuplicate,
            filter,
            matchFilter,
            data,
            count,
            query,
        });
    }

    if (error) {
        throw error;
    }
    return { data: data ?? [], total: count ?? 0 };
};
