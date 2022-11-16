const moment = require("moment/moment");
const { prisma } = require("../database");
const {
  createError,
  createResponse,
  getNextDay,
  getPreviousDay,
  getUserFcmTokens,
} = require("../utils/helperFunctions");
const Notification = require("./NotificationServices");

const OrderService = {
  async createOrderWithItems(data) {
    const { items, ...details } = data.input;
    const userExist = await prisma.user.findUnique({
      where: { id: details.userId },
    });
    if (!userExist) return createError(400, "User not found!");
    try {
      const isTodaysOrder = await prisma.order.findFirst({
        where: {
          createdAt: {
            lte: getNextDay(
              new Date(moment(new Date()).format("YYYY-MM-DD"))
            ).toISOString(),
            gt: new Date(moment(new Date()).format("YYYY-MM-DD")).toISOString(),
          },
          userId: details.userId,
        },
      });
      if (!isTodaysOrder) {
        const response = await prisma.order.create({
          data: details,
        });
        for (let index = 0; index < items.length; index++) {
          const item = await prisma?.item.findUnique({
            where: { id: items[index]?.itemId },
          });
          items[index]["orderId"] = response.id;
          if (item?.id) {
            await prisma.orderItems.create({
              data: items[index],
            });
          }
        }
        return createResponse(response, true, "Order Created Successfully");
      } else {
        for (let index = 0; index < items.length; index++) {
          const item = await prisma?.item.findUnique({
            where: { id: items[index]?.itemId },
          });
          items[index]["orderId"] = isTodaysOrder.id;
          if (item?.id) {
            await prisma.orderItems.create({
              data: items[index],
            });
          }
        }
        const updateOrder = await prisma.order.update({
          where: {
            id: isTodaysOrder.id,
          },
          data: {
            totalAmount: isTodaysOrder.totalAmount + details.totalAmount,
          },
        });
        return createResponse(updateOrder, true, "Order Created Successfully");
      }
    } catch (error) {
      console.log(error);
      return createError(401, error);
    }
  },

  async updateOrder(data) {
    if (data?.input?.length > 0) {
      const inputs = data?.input;
      for (let index = 0; index < inputs?.length; index++) {
        const isOrder = await prisma.order.findUnique({
          where: {
            id: inputs[index].id,
          },
        });
        inputs[index]["remainingAmount"] =
          inputs[index]?.paidAmount - isOrder.totalAmount;
        try {
          const result = await prisma.order.update({
            where: {
              id: inputs[index].id,
            },
            data: inputs[index],
          });
        } catch (error) {
          console.log(error);
          return createError(401, error);
        }
      }
      if (data?.type) {
        const order = await prisma.order.findUnique({
          where: {
            id: data?.input[0]?.id,
          },
        });

        const user = await prisma.user.findUnique({
          where: {
            id: order.userId,
          },
        });
        Notification.send(
          [user.fcmToken],
          {},
          "Amount Returned",
          "Your today's remaining amount is Returned"
        );
      }
      return createResponse({}, true, "Order Updated Successfully");
    } else {
      return createError(400, "Bad input");
    }
  },

  async getCurrentRemainingAmount(data) {
    const isRemainingAmount = await prisma.order.findFirst({
      where: {
        createdAt: {
          lt: getNextDay(),
          gt: getPreviousDay(),
        },
        remainingAmount: {
          gt: 0,
        },
        userId: data?.userId,
      },
    });
    if (!isRemainingAmount) return createError(400, "All Clear for today!");
    return createResponse(
      isRemainingAmount,
      true,
      "Today Remaining Amount Order"
    );
  },

  async getOrderSummary(data) {
    console.log("getOrderSummary", data);
    try {
      const order = await prisma.orderItems.groupBy({
        by: ["itemId"],
        where: {
          createdAt: {
            // lte: getNextDay(new Date(new Date(data.date || new Date()).setHours(24))),
            // gte: getPreviousDay(new Date(new Date(data.date || new Date().setHours(0)))),
            lte: getNextDay(new Date(data.date)),
            gt: new Date(data.date),
          },
          Order: {
            riderId: {
              not: 0,
            },
          },
          // Order: {
          //   status: 'PAID'
          // }
        },
        _sum: {
          quantity: true,
          amount: true,
        },
      });

      const totalAmount = await prisma.order.aggregate({
        where: {
          createdAt: {
            lte: getNextDay(new Date(data.date)),
            gt: new Date(data.date),
          },
          riderId: {
            not: 0,
          },
          // status: 'PAID'
        },
        _sum: {
          totalAmount: true,
        },
      });
      if (order?.length > 0) {
        for (let index = 0; index < order.length; index++) {
          const orderItem = order[index];
          const item = await prisma.item.findUnique({
            where: {
              id: orderItem.itemId,
            },
            include: {
              Category: true,
            },
          });
          orderItem["item"] = item;
          orderItem["quantity"] = orderItem._sum.quantity;
          orderItem["amount"] = orderItem._sum.amount;
          delete orderItem["_sum"];
        }
      }
      var obj = createResponse(order, true, "Order Summary");
      obj["totalAmount"] = totalAmount._sum.totalAmount;
      return obj;
    } catch (error) {
      console.log("getOrderSummary error", error);
    }
  },

  async getOrderOverviewByDate(data) {
    const order = await prisma.order.groupBy({
      by: ["createdAt"],
      where: {
        createdAt: {
          gte: new Date(new Date(data.startDate || new Date()).setHours(0)),
          lte: new Date(new Date(data.endDate || new Date()).setHours(24)),
        },
        riderId: {
          not: 0,
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        totalAmount: true,
      },
    });
    if (order?.length > 0) {
      for (var i = 0; i < order?.length; i++) {
        const rider = await prisma.order.findFirst({
          where: {
            createdAt: order[i].createdAt,
            riderId: {
              not: 0,
            },
          },
          include: {
            User: true,
            Rider: true,
          },
        });
        order[i].rider = rider?.Rider || null;
        order[i].totalOrders = order[i]._count.id;
        order[i].totalAmount = order[i]._sum.totalAmount;
        delete order[i]._count;
        delete order[i]._sum;
      }
    }
    return createResponse(order, true, "Order Overview Response");
  },

  async orderPurchased(data) {
    Notification.send(
      await getUserFcmTokens(),
      {},
      "Lunch Arrived",
      "Your Order is Arrived Come in a cafeteria for a party 🥳️"
    );
    return createResponse(null, true, "Alert Send Successfully to all members");
  },
};

module.exports = OrderService;
