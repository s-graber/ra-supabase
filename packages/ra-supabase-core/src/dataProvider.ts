import { DataProvider, AuthProvider } from 'ra-core';
import { SupabaseClient } from '@supabase/supabase-js';
import jwt_decode from 'jwt-decode';

export const supabaseDataProvider = (
    client: SupabaseClient,
    resources: ResourcesOptions,
    authProvider: AuthProvider
): DataProvider => ({
    getList: async (resource, params) => {
        return getList({ client, resources, resource, params });
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
        return getList({ client, resources, resource, params });
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

const getList = async ({ client, resources, resource, params }) => {
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

    // console.info('fields', fields);
    const cleansedFields = [];
    for (var k of fields) {
        if (k.endsWith('_gte') || k.endsWith('_lte')) {
            console.info('found field ≥≤', k);
            cleansedFields.push(k.replace('_gte', '').replace('_lte', ''));
        } else {
            cleansedFields.push(k);
        }
    }
    const cleansedFieldsWithoutDuplicate = cleansedFields.filter(
        (item, pos, self) => self.indexOf(item) === pos
    );
    // console.info('cleansedFields', cleansedFieldsWithoutDuplicate);
    for (var filterKey in filter) {
        if (filterKey.endsWith('_gte') || filterKey.endsWith('_lte')) {
            delete filter[filterKey];
        }
    }
    // console.log('filter', filter);
    let query = client
        .from(resource)
        .select(cleansedFieldsWithoutDuplicate.join(', '), { count: 'exact' })
        .order(sort.field, { ascending: sort.order === 'ASC' })
        .match(filter)
        .range(rangeFrom, rangeTo);

    // console.info('filter', filter);
    for (var key in filter) {
        if (key.endsWith('_gte')) {
            // console.info('found ≥', filter[key]);
            query = query.gte(key.replace('_gte', ''), filter[key]);
        }
        if (key.endsWith('_lte')) {
            // console.info('found ≤', filter[key]);
            query = query.lte(key.replace('_lte', ''), filter[key]);
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

    if (error) {
        throw error;
    }
    return { data: data ?? [], total: count ?? 0 };
};
