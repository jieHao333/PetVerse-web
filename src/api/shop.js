import request from './request'

/* ==================== 商家入驻申请（用户端） ==================== */

/** 提交入驻申请 */
export const submitApply = (data) => request.post('/shop/apply', data)

/** 驳回后修改并重新提交申请 */
export const resubmitApply = (data) => request.put('/shop/apply', data)

/** 查询我最新的入驻申请及审批结果 */
export const getMyApply = () => request.get('/shop/apply/mine')

/* ==================== 入驻审批（管理端） ==================== */

/** 分页查询入驻申请（状态/店铺名筛选，待审核置顶） */
export const pageApply = (params) => request.get('/shop/admin/apply/page', { params })

/** 审批入驻申请：{ id, approved, rejectReason } */
export const auditApply = (data) => request.post('/shop/admin/apply/audit', data)

/* ==================== 商家中心（商家端） ==================== */

/** 查询我的店铺信息 */
export const getMerchantInfo = () => request.get('/shop/merchant/info')

/** 修改我的店铺信息 */
export const updateMerchantInfo = (data) => request.put('/shop/merchant/info', data)

/** 新增商品（默认下架） */
export const saveProduct = (data) => request.post('/shop/merchant/product', data)

/** 修改商品（含上下架） */
export const updateProduct = (data) => request.put('/shop/merchant/product', data)

/** 删除商品 */
export const deleteProduct = (id) => request.delete(`/shop/merchant/product/${id}`)

/** 分页查询我的商品（含下架） */
export const pageMyProducts = (params) => request.get('/shop/merchant/product/page', { params })

/* ==================== 商城浏览（买家端） ==================== */

/** 分页浏览商城商品（仅上架，支持名称/类型/店铺筛选） */
export const pageProducts = (params) => request.get('/shop/product/page', { params })

/** 查询商品详情 */
export const getProductDetail = (id) => request.get(`/shop/product/${id}`)

/** 查询店铺公开信息（店家页面头部展示） */
export const getStoreInfo = (id) => request.get(`/shop/store/${id}`)

/* ==================== 购物车（买家端） ==================== */

/** 加入购物车：{ productId, quantity }（同一商品重复加购累加） */
export const addCartItem = (data) => request.post('/shop/cart', data)

/** 查询我的购物车列表 */
export const listCart = () => request.get('/shop/cart')

/** 修改购物车条目数量：{ id, quantity } */
export const updateCartItem = (data) => request.put('/shop/cart', data)

/** 删除购物车条目 */
export const removeCartItem = (id) => request.delete(`/shop/cart/${id}`)

/* ==================== 订单（买家端） ==================== */

/** 从购物车勾选商品下单：{ cartItemIds, remark }（同一店铺，待支付） */
export const createOrder = (data) => request.post('/shop/order', data)

/** 直接购买下单：{ productId, quantity, remark }（不经过购物车，待支付） */
export const buyNowOrder = (data) => request.post('/shop/order/buy-now', data)

/** 支付订单（模拟支付，成功后生成取货码） */
export const payOrder = (id) => request.post(`/shop/order/${id}/pay`)

/** 取消订单（仅待支付，回补库存） */
export const cancelOrder = (id) => request.post(`/shop/order/${id}/cancel`)

/** 分页查询我的订单（支持状态筛选） */
export const pageMyOrders = (params) => request.get('/shop/order/page', { params })

/** 查询订单详情 */
export const getOrderDetail = (id) => request.get(`/shop/order/${id}`)

/* ==================== 商品评价（买家端） ==================== */

/** 发表商品评价：{ productId, rating, content }（需存在已完成订单且未评价过） */
export const saveProductReview = (data) => request.post('/shop/review', data)

/** 修改我的商品评价：{ id, rating, content }（仅本人可改） */
export const updateProductReview = (data) => request.put('/shop/review', data)

/** 删除我的商品评价（仅本人可删，删除后无法重新评价） */
export const deleteProductReview = (id) => request.delete(`/shop/review/${id}`)

/** 分页查询商品评价：{ productId, rating, pageNum, pageSize } */
export const pageProductReviews = (params) => request.get('/shop/review/page', { params })

/** 分页查询我的评价（聚合商品信息、店铺名称与回复互动数）：{ pageNum, pageSize } */
export const pageMyReviews = (params) => request.get('/shop/review/my/page', { params })

/** 查询商品评价汇总（平均分/总数/当前用户评价资格） */
export const getReviewSummary = (productId) => request.get(`/shop/review/summary/${productId}`)

/** 发表评价回复：{ reviewId, content, replyUserId? }（所有登录用户可互动） */
export const saveReviewReply = (data) => request.post('/shop/review/reply', data)

/** 分页查询评价回复：{ reviewId, pageNum, pageSize }（时间正序） */
export const pageReviewReplies = (params) => request.get('/shop/review/reply/page', { params })

/** 删除我的评价回复（仅本人可删） */
export const deleteReviewReply = (id) => request.delete(`/shop/review/reply/${id}`)

/* ==================== 店铺订单（商家端） ==================== */

/** 分页查询店铺订单（支持状态筛选） */
export const pageMerchantOrders = (params) => request.get('/shop/merchant/order/page', { params })

/** 到店核销完成订单（可选校验买家出示的取货码） */
export const completeOrder = (id, pickupCode) =>
  request.post(`/shop/merchant/order/${id}/complete`, null, { params: { pickupCode } })

/* ==================== 图片/视频上传 ==================== */

/** 上传商城图片（营业执照/商品主图/评价晒单图，≤5MB），返回OSS地址 */
export const uploadShopImage = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/shop/file', formData)
}

/** 上传评价晒单视频（mp4/mov/m4v/webm，≤50MB），返回OSS地址 */
export const uploadShopVideo = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/shop/file/video', formData)
}
