import request from './request'

// 数据中台管理端 BI 接口（仅管理员，网关与后端双重角色校验）
export const getBiOverview = () => request.get('/data/admin/overview')
export const getBiMetrics = (params) => request.get('/data/admin/metrics', { params })
export const getBiProducts = (params) => request.get('/data/admin/products', { params })
export const getBiProfiles = (params) => request.get('/data/admin/profiles', { params })
export const getBiEvents = (params) => request.get('/data/admin/events', { params })
export const triggerAggregate = () => request.post('/data/admin/aggregate')
export const getModels = () => request.get('/data/admin/models')
export const trainModel = () => request.post('/data/admin/train')