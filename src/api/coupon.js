import request from './request'

/* ==================== 优惠券管理（管理端） ==================== */

/** 分页查询优惠券（名称/状态/折扣类型筛选） */
export const pageCoupons = (params) => request.get('/shop/admin/coupons/page', { params })

/** 查询优惠券详情（含限定范围名称） */
export const getCoupon = (id) => request.get(`/shop/admin/coupons/${id}`)

/** 新增优惠券（金额单位：分；scopeType 1-分类 2-商品） */
export const createCoupon = (data) => request.post('/shop/admin/coupons', data)

/** 发放优惠券：body 必带 id、issueEndTime，可选 issueBeginTime/termDays/termBeginTime/termEndTime */
export const issueCoupon = (id, data) => request.put(`/shop/admin/coupons/${id}/issue`, data)

/** 暂停发放（未开始/发放中可用） */
export const pauseCoupon = (id) => request.put(`/shop/admin/coupons/${id}/pause`)

/** 删除优惠券（仅待发放状态） */
export const deleteCoupon = (id) => request.delete(`/shop/admin/coupons/${id}`)

/** 分页查询兑换码（status：1-待兑换 2-已兑换） */
export const pageCouponCodes = (params) => request.get('/shop/admin/coupon-codes/page', { params })

/* ==================== 优惠券（用户端） ==================== */

/** 查询发放中的优惠券列表（含当前用户可领取/已领取状态） */
export const getIssuingCoupons = () => request.get('/shop/coupons/list')

/** 领取优惠券 */
export const receiveCoupon = (couponId) => request.post(`/shop/user-coupons/${couponId}/receive`)

/** 兑换码兑换优惠券 */
export const exchangeCoupon = (code) => request.post(`/shop/user-coupons/${code}/exchange`)

/** 分页查询我的优惠券（status：1-未使用 2-已使用 3-已过期） */
export const pageMyCoupons = (params) => request.get('/shop/user-coupons/page', { params })

/**
 * 查询我的优惠券在当前订单商品下的可用方案
 * 入参：[{ id: 商品ID, categoryId: 商品分类, price: 行总价(分) }]
 */
export const queryAvailableCoupons = (products) => request.post('/shop/user-coupons/available', products)
